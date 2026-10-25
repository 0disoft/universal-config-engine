import { realpath } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { loadConfig, type LoadConfigInput } from "./load-config.js";
import type { CreateConfigReloaderInput } from "./reload.js";
import { isInsideOrEqualPath } from "./pipeline/source-paths.js";
import { watchConfigPathSet, type ConfigWatchDependencies, type WatchConfigFilesResult } from "./watch.js";
import { runWatchSetup } from "./watch-setup.js";

// Two ordinary graphs (16 declarations + 64 file sources each) fit during recovery.
const MAX_TRACKED_PATHS = 160;

export interface WatchConfigInput extends LoadConfigInput,
  Pick<CreateConfigReloaderInput, "onChange" | "loadTimeoutMs" | "observerTimeoutMs"> {
  readonly workspacePath: string;
  readonly debounceMs?: number;
}

/** Automatically follows the selected declaration graph using the shared app loader. */
export async function watchConfig(input: WatchConfigInput, dependencies?: ConfigWatchDependencies): Promise<WatchConfigFilesResult> {
  if (input.signal?.aborted) return { ok: false, code: "watch_setup_failed" };
  let cwd: string, configPath: string, workspacePath: string;
  try {
    cwd = resolve(input.cwd ?? process.cwd());
    configPath = resolve(cwd, input.configPath);
    workspacePath = resolve(cwd, input.workspacePath);
  } catch { return { ok: false, code: "watch_input_invalid" }; }
  if (!isInsideOrEqualPath(workspacePath, configPath)) return { ok: false, code: "watch_path_outside_workspace" };
  try {
    const root = await runWatchSetup(input, () => (dependencies?.realpath ?? realpath)(workspacePath));
    configPath = resolve(root, relative(workspacePath, configPath));
    workspacePath = root;
  } catch { return { ok: false, code: "watch_setup_failed" }; }
  const captured = { ...input, cwd, configPath, workspacePath };
  let good = new Set([configPath]);
  return watchConfigPathSet({ ...captured, paths: [configPath], async load(options, select) {
    const pending = new Set([configPath]);
    const loaded = await loadConfig({ ...captured, ...options, async onDependencies(paths) {
      if (options.signal?.aborted) throw new Error("Configuration watch is closed.");
      for (const path of paths) {
        if (!isInsideOrEqualPath(workspacePath, path)) throw new Error("Dependency left the workspace.");
        if (!pending.has(path) && pending.size >= MAX_TRACKED_PATHS) throw new Error("Dependency count exceeded its budget.");
        pending.add(path);
      }
      // Keep last-good dependencies until the entire new configuration succeeds.
      await select([...new Set([...good, ...pending])]);
      await captured.onDependencies?.(paths);
    } });
    if (options.signal?.aborted) return loaded;
    if (loaded.result.ok && loaded.report.status === "ok") {
      await select([...pending]);
      good = pending;
    }
    return loaded;
  } }, dependencies, { maxPaths: MAX_TRACKED_PATHS, keepUnavailable: true });
}
