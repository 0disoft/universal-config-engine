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
  const groups = new Map<string, Set<string>>();
  try {
    const root = await realpath(input.workspacePath);
    if (!(await stat(root)).isDirectory()) return { ok: false, code: "watch_setup_failed" };
    for (const path of input.paths) {
      if (typeof path !== "string" || path.length === 0 || path.length > 4096) return { ok: false, code: "watch_input_invalid" };
      const absolute = resolve(root, path);
      const directory = await realpath(dirname(absolute));
      if (!inside(root, directory)) return { ok: false, code: "watch_path_outside_workspace" };
      try {
        if (!inside(root, await realpath(absolute))) return { ok: false, code: "watch_path_outside_workspace" };
      } catch (error) {
        if (error === null || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
      }
      const names = groups.get(directory) ?? new Set<string>();
      names.add(basename(absolute)); groups.set(directory, names);
    }
  } catch { return { ok: false, code: "watch_setup_failed" }; }
  const state = createReloadState(input);
  const handles: FSWatcher[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let watchFailed = false;
  function close() {
    if (closed) return;
    closed = true;
    if (timer !== undefined) clearTimeout(timer);
    for (const handle of handles) handle.close();
    state.controller.close();
  }
  try {
    for (const [directory, names] of groups) {
      const handle = watch(directory, { persistent: false }, (_event, filename) => {
        if (closed || filename !== null && !names.has(filename)) return;
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(() => { timer = undefined; if (!closed) void state.controller.refresh(); }, delay);
      });
      handles.push(handle);
      handle.on("error", () => { watchFailed = true; state.watchFailed(); close(); });
    }
    // Install watches before the first load so a change during loading is queued.
    const initial = await state.controller.refresh();
    if (watchFailed) return { ok: false, code: "watch_setup_failed" };
    return { ok: true, watcher: { ...state.controller, close }, initial };
  } catch { close(); return { ok: false, code: "watch_setup_failed" }; }
}

function inside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}
