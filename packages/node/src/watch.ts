import { watch } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ConfigOperationOptions, RunConfigPipelineResult } from "@0disoft/universal-config-engine-core";
import { createReloadState, type ConfigReloader, type ConfigReloadOutcome, type CreateConfigReloaderInput } from "./reload.js";
import { runWatchSetup } from "./watch-setup.js";

export interface ConfigWatchHandle {
  close(): void;
  on(event: "error", listener: () => void): unknown;
}
export interface ConfigWatchDependencies {
  realpath(path: string): Promise<string>;
  stat(path: string): Promise<{ isDirectory(): boolean }>;
  watch(directory: string, options: { persistent: false },
    listener: (event: string, filename: string | null) => void): ConfigWatchHandle;
  /** Schedule once and return an idempotent cancellation function. */
  schedule(callback: () => void, delayMs: number): () => void;
}
const nativeDependencies: ConfigWatchDependencies = { realpath, stat, watch,
  schedule(callback, delayMs) { const timer = setTimeout(callback, delayMs); return () => clearTimeout(timer); }
};

const WATCH_LIMITS = {
  defaultDebounceMs: 25,
  maxDebounceMs: 1000,
  maxWaitMs: 1000,
  maxPaths: 64,
  maxDirectories: 128,
  maxPathChars: 4096
} as const;

export interface WatchConfigFilesInput extends CreateConfigReloaderInput {
  readonly workspacePath: string;
  readonly paths: readonly string[];
  readonly debounceMs?: number;
}

export type WatchConfigFilesResult =
  | { readonly ok: true; readonly watcher: ConfigReloader; readonly initial: ConfigReloadOutcome }
  | { readonly ok: false; readonly code: "watch_input_invalid" | "watch_path_outside_workspace" | "watch_setup_failed" };

/** Watches selected basenames in their parent directories, including atomic replacements. */
export async function watchConfigFiles(input: WatchConfigFilesInput, dependencies: ConfigWatchDependencies = nativeDependencies): Promise<WatchConfigFilesResult> {
  return watchConfigPathSet({ ...input, load: options => input.load(options) }, dependencies);
}

/** Internal shared engine: dependency discovery can subscribe before reading new files. */
export async function watchConfigPathSet(input: Omit<WatchConfigFilesInput, "load"> & {
  readonly load: (options: ConfigOperationOptions, select: (paths: readonly string[]) => Promise<void>) => Promise<RunConfigPipelineResult>;
}, dependencies: ConfigWatchDependencies = nativeDependencies, policy: {
  readonly maxPaths?: number; readonly keepUnavailable?: boolean;
} = {}): Promise<WatchConfigFilesResult> {
  if (input.signal?.aborted) return { ok: false, code: "watch_setup_failed" };
  const delay = input.debounceMs ?? WATCH_LIMITS.defaultDebounceMs;
  const maximum = policy.maxPaths ?? WATCH_LIMITS.maxPaths;
  let paths = copyPaths(input.paths, maximum);
  if (paths === undefined || !Number.isSafeInteger(delay) || delay < 0 || delay > WATCH_LIMITS.maxDebounceMs) return { ok: false, code: "watch_input_invalid" };
  let root: string;
  let groups: Map<string, Set<string>>;
  try {
    const setup = await runWatchSetup(input, async assertActive => {
      const root = await dependencies.realpath(input.workspacePath);
      assertActive();
      const stats = await dependencies.stat(root);
      assertActive();
      if (!stats.isDirectory()) throw new Error("Watch root is not a directory.");
      const groups = await resolveWatchGroups(root, paths!, { realpath(path) {
        assertActive();
        return dependencies.realpath(path);
      } }, policy.keepUnavailable);
      return { root, groups };
    });
    if (setup.groups === undefined) return { ok: false, code: "watch_path_outside_workspace" };
    root = setup.root;
    groups = setup.groups;
  } catch { return { ok: false, code: "watch_setup_failed" }; }
  const handles = new Map<string, { handle: ConfigWatchHandle; filter: { names: Set<string> } }>();
  let timer: (() => void) | undefined;
  let maxWaitTimer: (() => void) | undefined;
  const pendingCancellations = new Set<() => void>();
  let closed = false;
  let disposing = false;
  let watchFailed = false;
  const state = createReloadState({ ...input, async load(options) {
    // Refresh is serialized by the reload state, including watch rebinding.
    await select(paths!, true);
    return input.load(options ?? {}, select);
  } });
  async function select(next: readonly string[], force = false) {
    if (closed) throw new Error("Watcher is closed.");
    const owned = copyPaths(next, maximum);
    if (owned === undefined) throw new Error("Watch path selection exceeds its input budget.");
    if (!force && owned.length === paths!.length && owned.every((path, index) => path === paths![index])) return;
    const selected = await resolveWatchGroups(root, owned, dependencies, policy.keepUnavailable);
    if (closed) throw new Error("Watcher is closed.");
    if (selected === undefined) throw new Error("Watch target left the workspace.");
    try { reconcile(selected); }
    catch (error) { watchFailed = true; state.watchFailed(); close(); throw error; }
    paths = owned;
  }
  function close() {
    closed = true;
    if (disposing) return;
    disposing = true;
    try {
      clearTimers();
      try { input.signal?.removeEventListener("abort", close); }
      catch { /* A custom signal must not prevent handle cleanup. */ }
      for (const [directory, { handle }] of handles) {
        try { handle.close(); handles.delete(directory); }
        catch { /* Retain failed handles so an explicit close can retry them. */ }
      }
    } finally {
      try { state.controller.close(); }
      finally { disposing = false; }
    }
  }
  function clearTimers(): boolean {
    if (timer !== undefined) pendingCancellations.add(timer);
    if (maxWaitTimer !== undefined) pendingCancellations.add(maxWaitTimer);
    timer = undefined;
    maxWaitTimer = undefined;
    for (const cancel of pendingCancellations) {
      try { cancel(); pendingCancellations.delete(cancel); }
      catch { /* Other timers and handles must still be released. */ }
    }
    return pendingCancellations.size === 0;
  }
  function flush() {
    if (!clearTimers()) { failWatch(); return; }
    if (!closed) void refresh();
  }
  async function refresh(): Promise<ConfigReloadOutcome> {
    const outcome = await state.controller.refresh();
    if (!outcome.ok && outcome.reason === "load_timeout") close();
    return outcome;
  }
  function failWatch() {
    watchFailed = true;
    state.watchFailed();
    close();
  }
  function reconcile(selected: Map<string, Set<string>>) {
    // Release stale targets first so rebinding keeps the same handle bound.
    for (const [directory, { handle }] of handles) {
      if (!selected.has(directory)) { handle.close(); handles.delete(directory); }
    }
    for (const [directory, names] of selected) {
      if (closed) throw new Error("Watcher is closed.");
      const existing = handles.get(directory);
      if (existing !== undefined) { existing.filter.names = names; continue; }
      const filter = { names };
      const handle = dependencies.watch(directory, { persistent: false }, (_event, filename) => {
        if (closed || filename !== null && !filter.names.has(filename)) return;
        try {
          if (timer !== undefined) timer();
          timer = dependencies.schedule(flush, delay);
          // Continuous writes must not postpone refresh indefinitely.
          if (maxWaitTimer === undefined) maxWaitTimer = dependencies.schedule(flush, WATCH_LIMITS.maxWaitMs);
        } catch { failWatch(); }
      });
      handles.set(directory, { handle, filter });
      handle.on("error", () => {
        if (handles.get(directory)?.handle !== handle) return;
        failWatch();
      });
    }
  }
  input.signal?.addEventListener("abort", close, { once: true });
  try {
    if (input.signal?.aborted) { close(); return { ok: false, code: "watch_setup_failed" }; }
    reconcile(groups);
    // Install watches before the first load so a change during loading is queued.
    const initial = await refresh();
    if (watchFailed || input.signal?.aborted || !initial.ok && initial.reason === "load_timeout") {
      close(); return { ok: false, code: "watch_setup_failed" };
    }
    return { ok: true, watcher: { ...state.controller, refresh, close }, initial };
  } catch { close(); return { ok: false, code: "watch_setup_failed" }; }
}

/** Watch path components as well as targets, within fixed handle/I/O budgets. */
async function resolveWatchGroups(root: string, paths: readonly string[], dependencies: Pick<ConfigWatchDependencies, "realpath">, keepUnavailable = false): Promise<Map<string, Set<string>> | undefined> {
  const groups = new Map<string, Set<string>>();
  const canonicalPaths = new Map<string, Promise<string>>();
  function canonicalize(path: string): Promise<string> {
    let pending = canonicalPaths.get(path);
    if (pending === undefined) {
      if (canonicalPaths.size >= WATCH_LIMITS.maxDirectories + WATCH_LIMITS.maxPaths) {
        throw new Error("Watch path resolution exceeded its budget.");
      }
      pending = dependencies.realpath(path);
      canonicalPaths.set(path, pending);
    }
    return pending;
  }
  function add(directory: string, name: string) {
    if (!groups.has(directory) && groups.size >= WATCH_LIMITS.maxDirectories) {
      throw new Error("Watch directory selection exceeded its budget.");
    }
    const names = groups.get(directory) ?? new Set<string>();
    names.add(name); groups.set(directory, names);
  }
  async function addAncestors(path: string): Promise<boolean> {
    const child = relative(root, path);
    if (child === "" || !inside(root, path)) return false;
    let parent = root;
    for (const name of child.split(sep)) {
      let directory: string;
      try { directory = await canonicalize(parent); }
      catch (error) { if (keepUnavailable && unavailable(error)) return true; throw error; }
      if (!inside(root, directory)) return keepUnavailable;
      add(directory, name);
      parent = resolve(parent, name);
    }
    return true;
  }
  for (const path of paths) {
    const absolute = resolve(root, path);
    // Watching only realpath(dirname(file)) misses replacement of an intermediate
    // directory/link. Subscribe to each component in its canonical parent.
    if (!await addAncestors(absolute)) return undefined;
    try {
      const target = await canonicalize(absolute);
      if (!await addAncestors(target) && !keepUnavailable) return undefined;
    } catch (error) {
      if (error === null || typeof error !== "object" || !("code" in error) ||
          error.code !== "ENOENT" && !(keepUnavailable && unavailable(error))) throw error;
    }
  }
  return groups;
}

function unavailable(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error &&
    ["ENOENT", "ENOTDIR", "ELOOP"].includes(String(error.code));
}

function copyPaths(input: readonly string[], maximum: number): string[] | undefined {
  if (!Array.isArray(input) || input.length === 0 || input.length > maximum) return undefined;
  const count = input.length;
  const paths: string[] = [];
  for (let index = 0; index < count; index++) {
    const path = input[index];
    if (typeof path !== "string" || path.length === 0 || path.length > WATCH_LIMITS.maxPathChars) return undefined;
    paths.push(path);
  }
  return paths;
}

function inside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}
