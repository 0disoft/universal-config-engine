import type { CliCommand, CliOutputMode } from "./types.js";

export interface ParsedCliArgs {
  readonly command: CliCommand;
  readonly configPath: string;
  readonly output: CliOutputMode;
  readonly sourceArgv: readonly string[];
}

export interface CliUsageContext {
  readonly command?: CliCommand;
  readonly output: CliOutputMode;
}

export function parseCliArgs(args: readonly string[]): ParsedCliArgs {
  const [commandCandidate, ...rest] = args;
  if (commandCandidate !== "explain" && commandCandidate !== "validate") {
    throw new Error("Expected command explain or validate.");
  }

  const separatorIndex = rest.indexOf("--");
  const cliArgs = separatorIndex === -1 ? rest : rest.slice(0, separatorIndex);
  const sourceArgv = separatorIndex === -1 ? [] : rest.slice(separatorIndex + 1);
  let configPath: string | undefined;
  let output: CliOutputMode = "human";

  for (let index = 0; index < cliArgs.length; index += 1) {
    const arg = cliArgs[index];
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

  return {
    command: commandCandidate,
    configPath,
    output,
    sourceArgv
  };
}

export function getCliUsageContext(args: readonly string[]): CliUsageContext {
  const [commandCandidate, ...rest] = args;
  const command =
    commandCandidate === "explain" || commandCandidate === "validate"
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
  if (value === undefined || value.startsWith("--")) {
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
