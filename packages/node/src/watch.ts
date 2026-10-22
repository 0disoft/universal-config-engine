import { watch } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { createReloadState, type ConfigReloader, type ConfigReloadOutcome, type CreateConfigReloaderInput } from "./reload.js";

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
  if (input.signal?.aborted) return { ok: false, code: "watch_setup_failed" };
  const delay = input.debounceMs ?? WATCH_LIMITS.defaultDebounceMs;
  if (!Array.isArray(input.paths) || input.paths.length === 0 || input.paths.length > WATCH_LIMITS.maxPaths ||
      !Number.isSafeInteger(delay) || delay < 0 || delay > WATCH_LIMITS.maxDebounceMs) return { ok: false, code: "watch_input_invalid" };
  const count = input.paths.length;
  const paths: string[] = [];
  for (let index = 0; index < count; index++) {
    const path = input.paths[index];
    if (typeof path !== "string" || path.length === 0 || path.length > WATCH_LIMITS.maxPathChars) return { ok: false, code: "watch_input_invalid" };
    paths.push(path);
  }
  let root: string;
  let groups: Map<string, Set<string>>;
  try {
    root = await dependencies.realpath(input.workspacePath);
    if (!(await dependencies.stat(root)).isDirectory()) return { ok: false, code: "watch_setup_failed" };
    const selected = await resolveWatchGroups(root, paths, dependencies);
    if (selected === undefined) return { ok: false, code: "watch_path_outside_workspace" };
    groups = selected;
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
    const selected = await resolveWatchGroups(root, paths, dependencies);
    if (closed) throw new Error("Watcher is closed.");
    if (selected === undefined) throw new Error("Watch target left the workspace.");
    try { reconcile(selected); }
    catch (error) { watchFailed = true; state.watchFailed(); close(); throw error; }
    return input.load(options);
  } });
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

/** At most two parent-directory selections per bounded input path. */
async function resolveWatchGroups(root: string, paths: readonly string[], dependencies: ConfigWatchDependencies): Promise<Map<string, Set<string>> | undefined> {
  const groups = new Map<string, Set<string>>();
  const canonicalPaths = new Map<string, Promise<string>>();
  function canonicalize(path: string): Promise<string> {
    let pending = canonicalPaths.get(path);
    if (pending === undefined) {
      pending = dependencies.realpath(path);
      canonicalPaths.set(path, pending);
    }
    return pending;
  }
  function add(directory: string, name: string) {
    const names = groups.get(directory) ?? new Set<string>();
    names.add(name); groups.set(directory, names);
  }
  for (const path of paths) {
    const absolute = resolve(root, path);
    const directory = await canonicalize(dirname(absolute));
    if (!inside(root, directory)) return undefined;
    add(directory, basename(absolute));
    try {
      const target = await canonicalize(absolute);
      if (!inside(root, target)) return undefined;
      add(dirname(target), basename(target));
    } catch (error) {
      if (error === null || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
    }
  }
  return groups;
}

function inside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}
