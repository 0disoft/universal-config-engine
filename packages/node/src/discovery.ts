import { lstat, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ConfigIssue } from "@0disoft/universal-config-engine-core";
import { positiveSafeIntegerLimit } from "./limits.js";

export const DEFAULT_PIPELINE_FILENAMES: readonly string[] = Object.freeze(["uce.json", ".uce.json", "uce.config.json"]);

export interface DiscoverPipelineInput {
  readonly workspacePath: string;
  /** Relative to workspacePath unless absolute; defaults to the workspace root. */
  readonly startPath?: string;
  /** Defaults to 32; a hard cap of 256 directories always applies. */
  readonly maxDirectories?: number;
}

export type DiscoverPipelineResult =
  | { readonly ok: true; readonly configPath: string; readonly workspacePath: string; readonly searchedDirectories: number }
  | { readonly ok: false; readonly issues: readonly ConfigIssue[] };

/** Select a JSON declaration without reading data or executing configuration code. */
export async function discoverPipelineDeclaration(input: DiscoverPipelineInput): Promise<DiscoverPipelineResult> {
  try {
    const workspacePath = await realpath(resolve(input.workspacePath));
    let directory = await realpath(resolve(workspacePath, input.startPath ?? "."));
    if (!inside(workspacePath, directory)) return failure("config_discovery_outside_workspace");
    if (!(await stat(workspacePath)).isDirectory() || !(await stat(directory)).isDirectory()) {
      return failure("config_discovery_failed");
    }
    const maximum = Math.min(256, positiveSafeIntegerLimit(input.maxDirectories, 32));
    for (let searchedDirectories = 1; searchedDirectories <= maximum; searchedDirectories += 1) {
      for (const filename of DEFAULT_PIPELINE_FILENAMES) {
        const candidate = join(directory, filename);
        try { await lstat(candidate); }
        catch (error) {
          if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT") continue;
          return failure("config_discovery_failed");
        }
        // An existing but broken/unsafe first candidate is an error, not permission
        // to silently use an older declaration farther up the workspace.
        const configPath = await realpath(candidate);
        if (!inside(workspacePath, configPath)) return failure("config_discovery_outside_workspace");
        if (!(await stat(configPath)).isFile()) return failure("config_discovery_not_file");
        return { ok: true, configPath, workspacePath, searchedDirectories };
      }
      if (directory === workspacePath) return failure("config_not_found");
      directory = dirname(directory);
    }
    return failure("max_discovery_directories_exceeded", "resource-limit");
  } catch {
    return failure("config_discovery_failed");
  }
}

function inside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function failure(code: string, category: ConfigIssue["category"] = "source-load"): DiscoverPipelineResult {
  return { ok: false, issues: [{ code, category, severity: "error",
    message: category === "resource-limit" ? "Configuration discovery exceeded its directory budget."
      : code === "config_not_found" ? "No supported pipeline declaration was found inside the workspace."
      : "Configuration discovery failed. Check the workspace, selected path and file permissions." }] };
}
