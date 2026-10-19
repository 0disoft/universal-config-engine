import type { ConfigIssue, ConfigSourceDescriptor, LoadedSource } from "@0disoft/universal-config-engine-core";
import type { FileReadPolicy } from "./file.js";
import { loadTextFileSource } from "./file-source.js";

const DOTENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface LoadDotenvFileSourceInput extends FileReadPolicy {
  readonly descriptor: ConfigSourceDescriptor;
  readonly filePath: string;
}

export async function loadDotenvFileSource(input: LoadDotenvFileSourceInput): Promise<LoadedSource> {
  return loadTextFileSource(input, {
    readFailure: {
      category: "source-load",
      code: "dotenv_read_failed",
      message: "Failed to read dotenv source. Exception details were omitted from diagnostics."
    },
    parse: (raw, canonicalPath) => parseSimpleDotenv(input.descriptor, raw, canonicalPath)
  });
}

export function parseSimpleDotenv(
  descriptor: ConfigSourceDescriptor,
  raw: string,
  sourcePath?: string
): LoadedSource {
  const value: Record<string, string> = {};
  const issues: ConfigIssue[] = [];
  const locationByName = new Map<string, NonNullable<LoadedSource["locations"]>[number]>();
  const lines = raw.split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      issues.push(dotenvIssue(descriptor.id, index + 1, "dotenv_invalid_line", "Expected KEY=VALUE."));
      continue;
    }

    const name = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1);
    if (!DOTENV_NAME_PATTERN.test(name)) {
      issues.push(dotenvIssue(descriptor.id, index + 1, "dotenv_invalid_name", "Invalid dotenv variable name."));
      continue;
    }

    value[name] = stripSimpleQuotes(rawValue.trim());
    locationByName.set(name, {
      path: [name],
      location: {
        sourceId: descriptor.id,
        ...(sourcePath === undefined ? {} : { sourcePath }),
        line: index + 1,
        column: line.indexOf(name) + 1
      }
    });
  }

  return {
    descriptor,
    value,
    locations: [...locationByName.values()],
    issues
  };
}

function stripSimpleQuotes(value: string): string {
  if (
    value.length >= 2 && (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function dotenvIssue(sourceId: string, line: number, code: string, message: string): ConfigIssue {
  return {
    category: "parse",
    code,
    severity: "error",
    sourceId,
    message,
    details: {
      line
    }
  };
}
