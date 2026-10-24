import { readFile } from "node:fs/promises";
import type { CliResult, CliRuntime } from "./types.js";

const COMMANDS = new Set(["explain", "validate", "diff", "init", "doctor"]);
const HELP = `Usage: uce <command> [options]

Commands:
  init       Create a non-overwriting defaults, env mapping and schema example
  doctor     Validate a declaration and show diagnostic paths and next actions
  explain    Explain source precedence and redacted diagnostics
  validate   Resolve configuration and run declared validators
  diff       Compare --config <before.json> --against <after.json>

Options:
  --config <file>        JSON pipeline declaration
  --discover <folder>    Discover a declaration inside an explicit workspace
  --workspace <folder>   Restrict declaration and source paths to this folder
  --profile <name>       Select an explicitly declared profile
  --json                Structured output (init/doctor use separate envelopes)
  --public              Share-safe explain/validate/doctor diagnostics
  --values              Opt-in safe values for explain (never raw secrets)
  --path <JSON-array>    Inspect a typed path, for example '["server","port"]'
  --policy <file>        Apply change rules to diff
  --directory <folder>  Existing target directory for init
  --help, -h            Show help, also as uce <command> --help
  --version, -v         Show the installed CLI version

First use: uce init; uce doctor --config uce.json
Override the example port with APP_PORT, then run doctor again.
Arguments after -- are passed to explicitly declared argv sources.
`;

/** Information commands never discover or load user configuration. */
export async function runInformationCli(args: readonly string[], runtime: CliRuntime): Promise<CliResult | undefined> {
  const globalHelp = args.length === 1 && ["--help", "-h", "help"].includes(args[0]!);
  const commandHelp = args.length === 2 && (
    (COMMANDS.has(args[0]!) && ["--help", "-h"].includes(args[1]!)) ||
    (args[0] === "help" && COMMANDS.has(args[1]!))
  );
  if (globalHelp || commandHelp) {
    runtime.stdout(HELP);
    return { exitCode: 0 };
  }
  if (args.length === 1 && ["--version", "-v"].includes(args[0]!)) {
    const metadata = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    runtime.stdout(`${metadata.version}\n`);
    return { exitCode: 0 };
  }
  return undefined;
}
