import { isAbsolute, relative, resolve, sep } from "node:path";
import { discoverPipelineDeclaration } from "@0disoft/universal-config-engine-node";
import type { ConfigIssue } from "@0disoft/universal-config-engine-core";
import { parseInspectionArgs } from "./args.js";
import type { CliRuntime } from "./types.js";
import { isProfileName } from "./pipeline/declaration-fields.js";

export interface PreparedDiscoveryArgs {
  readonly args: readonly string[];
  readonly workspacePath?: string;
  readonly profile?: string;
  readonly issues?: readonly ConfigIssue[];
}

/** Keep filesystem selection outside the exported synchronous legacy parser. */
export async function prepareDiscoveryArgs(args: readonly string[], runtime: CliRuntime): Promise<PreparedDiscoveryArgs> {
  const separator = args.indexOf("--");
  const end = separator < 0 ? args.length : separator;
  const extensions = ["--discover", "--workspace", "--profile"];
  const requested = args.slice(0, end).some(arg => extensions.some(flag => arg === flag || arg.startsWith(`${flag}=`)));
  if (!requested) return { args };
  const options = args.slice(0, end);
  const sourceArgs = separator < 0 ? [] : args.slice(separator);
  const selected = new Map<string, string>();
  const remaining: string[] = [];
  for (let index = 0; index < options.length; index += 1) {
    const arg = options[index]!;
    const flag = extensions.find(flag => arg === flag || arg.startsWith(`${flag}=`));
    if (flag === undefined) { remaining.push(arg); continue; }
    if (selected.has(flag)) throw new Error(`Specify ${flag} only once.`);
    const value = arg === flag ? options[++index] : arg.slice(flag.length + 1);
    if (!value || value.startsWith("-")) throw new Error(`${flag} requires a value.`);
    selected.set(flag, value);
  }
  const profile = selected.get("--profile");
  if (profile !== undefined && !isProfileName(profile)) throw new Error("Use a valid profile name.");
  const profilePolicy = profile === undefined ? {} : { profile };
  const discovery = selected.get("--discover");
  const workspace = selected.get("--workspace");
  if (discovery === undefined) {
    const prepared = [...remaining, ...sourceArgs];
    parseInspectionArgs(prepared);
    return { args: prepared, ...profilePolicy, ...(workspace === undefined ? {} : { workspacePath: resolve(runtime.cwd, workspace) }) };
  }
  if (workspace !== undefined) throw new Error("--discover already defines the workspace; omit --workspace.");
  if (args[0] !== "explain" && args[0] !== "validate") throw new Error("Discovery requires explain or validate.");
  if (remaining.some(arg => arg === "--config" || arg === "-c" || arg.startsWith("--config="))) {
    throw new Error("Use either --config or --discover.");
  }
  const placeholder = [...remaining, "--config", ".uce-discovery-pending", ...sourceArgs];
  parseInspectionArgs(placeholder); // Reject invalid command options before touching files.
  const workspacePath = resolve(runtime.cwd, discovery);
  const path = relative(workspacePath, runtime.cwd);
  const cwdInside = path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
  const found = await discoverPipelineDeclaration({ workspacePath, startPath: cwdInside ? runtime.cwd : workspacePath });
  return found.ok
    ? { args: [...remaining, "--config", found.configPath, ...sourceArgs], workspacePath: found.workspacePath, ...profilePolicy }
    : { args: placeholder, issues: found.issues, ...profilePolicy };
}
