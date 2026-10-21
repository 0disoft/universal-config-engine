import { isAbsolute, relative, resolve, sep } from "node:path";
import { discoverPipelineDeclaration } from "@0disoft/universal-config-engine-node";
import type { ConfigIssue } from "@0disoft/universal-config-engine-core";
import { parseInspectionArgs } from "./args.js";
import type { CliRuntime } from "./types.js";

export interface PreparedDiscoveryArgs {
  readonly args: readonly string[];
  readonly workspacePath?: string;
  readonly issues?: readonly ConfigIssue[];
}

/** Keep filesystem selection outside the exported synchronous legacy parser. */
export async function prepareDiscoveryArgs(args: readonly string[], runtime: CliRuntime): Promise<PreparedDiscoveryArgs> {
  const separator = args.indexOf("--");
  const end = separator < 0 ? args.length : separator;
  let requested = false;
  for (let index = 0; index < end; index += 1) {
    if (args[index] === "--discover" || args[index]!.startsWith("--discover=")) { requested = true; break; }
  }
  if (!requested) return { args };
  const options = args.slice(0, end);
  const sourceArgs = separator < 0 ? [] : args.slice(separator);
  if (args[0] !== "explain" && args[0] !== "validate") throw new Error("Discovery requires explain or validate.");
  if (options.some(arg => arg === "--config" || arg === "-c" || arg.startsWith("--config="))) {
    throw new Error("Use either --config or --discover.");
  }
  let workspace: string | undefined;
  const remaining: string[] = [];
  for (let index = 0; index < options.length; index += 1) {
    const arg = options[index]!;
    if (arg !== "--discover" && !arg.startsWith("--discover=")) { remaining.push(arg); continue; }
    if (workspace !== undefined) throw new Error("Specify --discover only once.");
    workspace = arg === "--discover" ? options[++index] : arg.slice("--discover=".length);
    if (!workspace || workspace.startsWith("-")) throw new Error("Discovery requires a workspace path.");
  }
  const placeholder = [...remaining, "--config", ".uce-discovery-pending", ...sourceArgs];
  parseInspectionArgs(placeholder); // Reject invalid command options before touching files.
  const workspacePath = resolve(runtime.cwd, workspace!);
  const path = relative(workspacePath, runtime.cwd);
  const cwdInside = path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
  const found = await discoverPipelineDeclaration({ workspacePath, startPath: cwdInside ? runtime.cwd : workspacePath });
  return found.ok
    ? { args: [...remaining, "--config", found.configPath, ...sourceArgs], workspacePath: found.workspacePath }
    : { args: placeholder, issues: found.issues };
}
