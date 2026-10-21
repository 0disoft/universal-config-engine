import { open, realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { CliResult, CliRuntime } from "./types.js";

const INITIAL_DECLARATION = `${JSON.stringify({ sources: [
  { id: "defaults", kind: "object", priority: 0, value: {} }
] }, null, 2)}\n`;

/** Deliberately separate from the stable explain/validate parser and envelopes. */
export async function runInitCli(args: readonly string[], runtime: CliRuntime): Promise<CliResult> {
  const json = args.includes("--json");
  function output(status: "created" | "error", code: string, exitCode: number) {
    runtime.stdout(json ? `${JSON.stringify({ schemaVersion: "init-1", command: "init", status, code }, null, 2)}\n`
      : status === "created" ? "Created uce.json. Next: uce doctor --config uce.json\n"
        : code === "init_exists" ? "uce.json already exists. No file was changed.\n"
        : code === "cli_usage_error" ? "Usage: uce init [--directory <existing-directory>] [--json]\n"
        : "Initialization failed. Check the directory and write permissions; review any partial uce.json before retrying.\n");
    return { exitCode };
  }
  let directory: string | undefined;
  for (let index = 1; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--json") continue;
    if (arg !== "--directory" && !arg.startsWith("--directory=")) return output("error", "cli_usage_error", 4);
    if (directory !== undefined) return output("error", "cli_usage_error", 4);
    directory = arg === "--directory" ? args[++index] : arg.slice("--directory=".length);
    if (!directory || directory.startsWith("-")) return output("error", "cli_usage_error", 4);
  }
  let handle;
  try {
    const root = await realpath(resolve(runtime.cwd, directory ?? "."));
    if (!(await stat(root)).isDirectory()) return output("error", "init_directory_invalid", 2);
    handle = await open(join(root, "uce.json"), "wx", 0o600);
    await handle.writeFile(INITIAL_DECLARATION, "utf8");
    await handle.close(); handle = undefined;
    return output("created", "init_created", 0);
  } catch (error) {
    const exists = error !== null && typeof error === "object" && "code" in error && error.code === "EEXIST";
    return output("error", exists ? "init_exists" : "init_write_failed", exists ? 4 : 2);
  } finally { await handle?.close().catch(() => {}); }
}
