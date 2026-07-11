import type { ConfigIssue, ConfigSourceDescriptor, LoadedSource } from "@0disoft/universal-config-engine-core";
import { DEFAULT_MAX_FILE_BYTES, readTextFileWithinLimit, type FileReadPolicy } from "./file.js";

const DOTENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface LoadDotenvFileSourceInput extends FileReadPolicy {
  readonly descriptor: ConfigSourceDescriptor;
  readonly filePath: string;
}

export async function loadDotenvFileSource(input: LoadDotenvFileSourceInput): Promise<LoadedSource> {
  const maxFileBytes = input.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const encoding = input.encoding ?? "utf8";

  try {
    const readResult = await readTextFileWithinLimit({
      filePath: input.filePath,
      sourceId: input.descriptor.id,
      maxFileBytes,
      encoding,
      ...(input.allowedRootPath === undefined ? {} : { allowedRootPath: input.allowedRootPath })
    });
    if (!readResult.ok) {
      return {
        descriptor: input.descriptor,
        value: {},
        issues: readResult.issues
      };
    }

    return parseSimpleDotenv(input.descriptor, readResult.raw);
  } catch (error) {
    return {
      descriptor: input.descriptor,
      value: {},
      issues: [
        {
          category: "source-load",
          code: "dotenv_read_failed",
          severity: "error",
          sourceId: input.descriptor.id,
          message: error instanceof Error ? error.message : "Failed to read dotenv source."
        }
      ]
    };
  }
}

export function parseSimpleDotenv(descriptor: ConfigSourceDescriptor, raw: string): LoadedSource {
  const value: Record<string, string> = {};
  const issues: ConfigIssue[] = [];
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
      issues.push(dotenvIssue(descriptor.id, index + 1, "dotenv_invalid_name", `Invalid dotenv name ${name}.`));
      continue;
    }

    value[name] = stripSimpleQuotes(rawValue.trim());
  }

  return {
    descriptor,
    value,
    issues
  };
}

function stripSimpleQuotes(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
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
