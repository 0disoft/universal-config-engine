import { watch, type FSWatcher } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { createReloadState, type ConfigReloader, type ConfigReloadOutcome, type CreateConfigReloaderInput } from "./reload.js";

export interface WatchConfigFilesInput extends CreateConfigReloaderInput {
  readonly workspacePath: string;
  readonly paths: readonly string[];
  readonly debounceMs?: number;
}

export type WatchConfigFilesResult =
  | { readonly ok: true; readonly watcher: ConfigReloader; readonly initial: ConfigReloadOutcome }
  | { readonly ok: false; readonly code: "watch_input_invalid" | "watch_path_outside_workspace" | "watch_setup_failed" };

/** Watches selected basenames in their parent directories, including atomic replacements. */
export async function watchConfigFiles(input: WatchConfigFilesInput): Promise<WatchConfigFilesResult> {
  const delay = input.debounceMs ?? 25;
  if (!Array.isArray(input.paths) || input.paths.length === 0 || input.paths.length > 64 ||
      !Number.isSafeInteger(delay) || delay < 0 || delay > 1000) return { ok: false, code: "watch_input_invalid" };
  const count = input.paths.length;
  const paths: string[] = [];
  for (let index = 0; index < count; index++) {
    const path = input.paths[index];
    if (typeof path !== "string" || path.length === 0 || path.length > 4096) return { ok: false, code: "watch_input_invalid" };
    paths.push(path);
  }
  let root: string;
  let groups: Map<string, Set<string>>;
  try {
    root = await realpath(input.workspacePath);
    if (!(await stat(root)).isDirectory()) return { ok: false, code: "watch_setup_failed" };
    const selected = await resolveWatchGroups(root, paths);
    if (selected === undefined) return { ok: false, code: "watch_path_outside_workspace" };
    groups = selected;
  } catch { return { ok: false, code: "watch_setup_failed" }; }
  const handles = new Map<string, { handle: FSWatcher; filter: { names: Set<string> } }>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let watchFailed = false;
  const state = createReloadState({ ...input, async load() {
    // Refresh is serialized by the reload state, including watch rebinding.
    const selected = await resolveWatchGroups(root, paths);
    if (closed) throw new Error("Watcher is closed.");
    if (selected === undefined) throw new Error("Watch target left the workspace.");
    try { reconcile(selected); }
    catch (error) { watchFailed = true; state.watchFailed(); close(); throw error; }
    return input.load();
  } });
  function close() {
    if (closed) return;
    closed = true;
    if (timer !== undefined) clearTimeout(timer);
    for (const { handle } of handles.values()) handle.close();
    handles.clear();
    state.controller.close();
  }
  function reconcile(selected: Map<string, Set<string>>) {
    // Release stale targets first so rebinding keeps the same handle bound.
    for (const [directory, { handle }] of handles) {
      if (!selected.has(directory)) { handles.delete(directory); handle.close(); }
    }
    for (const [directory, names] of selected) {
      if (closed) throw new Error("Watcher is closed.");
      const existing = handles.get(directory);
      if (existing !== undefined) { existing.filter.names = names; continue; }
      const filter = { names };
      const handle = watch(directory, { persistent: false }, (_event, filename) => {
        if (closed || filename !== null && !filter.names.has(filename)) return;
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(() => { timer = undefined; if (!closed) void state.controller.refresh(); }, delay);
      });
      handles.set(directory, { handle, filter });
      handle.on("error", () => {
        if (handles.get(directory)?.handle !== handle) return;
        watchFailed = true; state.watchFailed(); close();
      });
    }
  }
  try {
    reconcile(groups);
    // Install watches before the first load so a change during loading is queued.
    const initial = await state.controller.refresh();
    if (watchFailed) return { ok: false, code: "watch_setup_failed" };
    return { ok: true, watcher: { ...state.controller, close }, initial };
  } catch { close(); return { ok: false, code: "watch_setup_failed" }; }
}

/** At most two parent-directory selections per bounded input path. */
async function resolveWatchGroups(root: string, paths: readonly string[]): Promise<Map<string, Set<string>> | undefined> {
  const groups = new Map<string, Set<string>>();
  function add(directory: string, name: string) {
    const names = groups.get(directory) ?? new Set<string>();
    names.add(name); groups.set(directory, names);
  }
  for (const path of paths) {
    const absolute = resolve(root, path);
    const directory = await realpath(dirname(absolute));
    if (!inside(root, directory)) return undefined;
    add(directory, basename(absolute));
    try {
      const target = await realpath(absolute);
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
