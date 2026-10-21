import type { ConfigPath } from "@0disoft/universal-config-engine-core";
import type { CliCommand, CliExecutionCommand, CliOutputMode } from "./types.js";

export interface ParsedInspectionArgs {
  readonly command: CliExecutionCommand;
  readonly configPath: string;
  readonly output: CliOutputMode;
  readonly sourceArgv: readonly string[];
  readonly values?: boolean;
  readonly path?: ConfigPath;
  readonly against?: string;
  readonly detectSecretChanges?: boolean;
  readonly policy?: string;
}

export interface ParsedCliArgs extends Omit<ParsedInspectionArgs, "command"> {
  readonly command: CliCommand;
}

export interface CliUsageContext {
  readonly command?: CliExecutionCommand;
  readonly output: CliOutputMode;
}

export function parseCliArgs(args: readonly string[]): ParsedCliArgs {
  const parsed = parseInspectionArgs(args);
  if (parsed.command === "diff") throw new Error("Expected command explain or validate.");
  return { ...parsed, command: parsed.command };
}

/** Extended installed-command parser; legacy parseCliArgs keeps its command union. */
export function parseInspectionArgs(args: readonly string[]): ParsedInspectionArgs {
  const [commandCandidate, ...rest] = args;
  if (commandCandidate !== "explain" && commandCandidate !== "validate" && commandCandidate !== "diff") {
    throw new Error("Expected command explain, validate or diff.");
  }

  const separatorIndex = rest.indexOf("--");
  const cliArgs = separatorIndex === -1 ? rest : rest.slice(0, separatorIndex);
  const sourceArgv = separatorIndex === -1 ? [] : rest.slice(separatorIndex + 1);
  let configPath: string | undefined;
  let output: CliOutputMode = "human";
  let values = false;
  let path: ConfigPath | undefined;
  let against: string | undefined;
  let detectSecretChanges = false;
  let policy: string | undefined;

  for (let index = 0; index < cliArgs.length; index += 1) {
    const arg = cliArgs[index];
    if (arg === "--policy" || arg?.startsWith("--policy=") === true) {
      policy = arg === "--policy" ? readValue(cliArgs, index++, arg) : arg.slice("--policy=".length);
      if (policy.length === 0) throw new Error("Policy requires a file path.");
      continue;
    }
    if (arg === "--against" || arg?.startsWith("--against=") === true) {
      against = arg === "--against" ? readValue(cliArgs, index++, arg) : arg.slice("--against=".length);
      continue;
    }
    if (arg === "--detect-secret-changes") {
      detectSecretChanges = true;
      continue;
    }
    if (arg === "--values") {
      values = true;
      continue;
    }
    if (arg === "--path" || arg?.startsWith("--path=") === true) {
      const raw = arg === "--path" ? readValue(cliArgs, index++, arg) : arg.slice("--path=".length);
      path = parseInspectionPath(raw);
      continue;
    }
    if (arg === "--config" || arg === "-c") {
      configPath = readValue(cliArgs, index, arg);
      index += 1;
      continue;
    }

    if (arg?.startsWith("--config=") === true) {
      configPath = arg.slice("--config=".length);
      continue;
    }

    if (arg === "--json") {
      output = "json";
      continue;
    }

    if (arg === "--output") {
      const value = readValue(cliArgs, index, arg);
      output = parseOutputMode(value);
      index += 1;
      continue;
    }

    if (arg?.startsWith("--output=") === true) {
      output = parseOutputMode(arg.slice("--output=".length));
      continue;
    }

    throw new Error("Unknown CLI option.");
  }

  if (configPath === undefined || configPath.length === 0) {
    throw new Error("Missing required --config path.");
  }
  if (values && commandCandidate !== "explain") {
    throw new Error("Value inspection options require explain.");
  }
  if (path !== undefined && commandCandidate === "validate") throw new Error("Path selection requires explain or diff.");
  if (commandCandidate === "diff" && (against === undefined || against.length === 0)) throw new Error("Diff requires --against path.");
  if (commandCandidate !== "diff" && (against !== undefined || detectSecretChanges || policy !== undefined)) throw new Error("Comparison options require diff.");
  if (policy !== undefined && path !== undefined) throw new Error("Policy checks require a complete comparison; omit --path.");

  return {
    command: commandCandidate,
    configPath,
    output,
    sourceArgv,
    ...(values || commandCandidate === "explain" && path !== undefined ? { values: true } : {}),
    ...(path === undefined ? {} : { path }),
    ...(against === undefined ? {} : { against }),
    ...(detectSecretChanges ? { detectSecretChanges: true } : {}),
    ...(policy === undefined ? {} : { policy })
  };
}

function parseInspectionPath(raw: string): ConfigPath {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("Path must be a JSON array of strings and nonnegative safe integers."); }
  if (!Array.isArray(value) || value.length > 256 || value.some((segment: unknown) =>
    !(typeof segment === "string" || typeof segment === "number" && Number.isSafeInteger(segment) && segment >= 0))) {
    throw new Error("Path must be a JSON array of strings and nonnegative safe integers.");
  }
  return value as ConfigPath;
}

export function getCliUsageContext(args: readonly string[]): CliUsageContext {
  const [commandCandidate, ...rest] = args;
  const command =
    commandCandidate === "explain" || commandCandidate === "validate" || commandCandidate === "diff"
      ? commandCandidate
      : undefined;
  const separatorIndex = rest.indexOf("--");
  const cliArgs = separatorIndex === -1 ? rest : rest.slice(0, separatorIndex);
  let output: CliOutputMode = "human";

  for (let index = 0; index < cliArgs.length; index += 1) {
    const arg = cliArgs[index];
    if (arg === "--json") {
      output = "json";
      continue;
    }

    if (arg === "--output") {
      if (cliArgs[index + 1] === "json") {
        output = "json";
      }
      index += 1;
      continue;
    }

    if (arg === "--output=json") {
      output = "json";
    }
  }

  return command === undefined ? { output } : { command, output };
}

function readValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("-")) {
    throw new Error(`Option ${option} requires a value.`);
  }
  return value;
}

function parseOutputMode(value: string): CliOutputMode {
  if (value === "human" || value === "json") {
    return value;
  }

  throw new Error("Output mode must be human or json.");
}
