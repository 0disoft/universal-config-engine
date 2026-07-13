import type { ConfigSourceDescriptor, LoadedSource } from "@0disoft/universal-config-engine-core";
import { visit, type JSONPath } from "jsonc-parser";
import { DEFAULT_MAX_FILE_BYTES, readTextFileWithinLimit, type FileReadPolicy } from "./file.js";

export interface LoadJsonFileSourceInput extends FileReadPolicy {
  readonly descriptor: ConfigSourceDescriptor;
  readonly filePath: string;
}

export async function loadJsonFileSource(input: LoadJsonFileSourceInput): Promise<LoadedSource> {
  const maxFileBytes = input.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const encoding = input.encoding ?? "utf8";
  let readResult: Awaited<ReturnType<typeof readTextFileWithinLimit>>;

  try {
    readResult = await readTextFileWithinLimit({
      filePath: input.filePath,
      sourceId: input.descriptor.id,
      maxFileBytes,
      encoding,
      ...(input.allowedRootPath === undefined ? {} : { allowedRootPath: input.allowedRootPath })
    });
  } catch {
    return {
      descriptor: input.descriptor,
      value: {},
      issues: [
        {
          category: "source-load",
          code: "json_read_failed",
          severity: "error",
          sourceId: input.descriptor.id,
          message: "Failed to read JSON source. Exception details were omitted from diagnostics."
        }
      ]
    };
  }

  if (!readResult.ok) {
    return {
      descriptor: input.descriptor,
      value: {},
      issues: readResult.issues
    };
  }

  try {
    return {
      descriptor: input.descriptor,
      value: JSON.parse(readResult.raw) as unknown,
      locations: collectJsonLocations(input.descriptor.id, readResult.canonicalPath, readResult.raw)
    };
  } catch {
    return {
      descriptor: input.descriptor,
      value: {},
      issues: [
        {
          category: "parse",
          code: "json_parse_failed",
          severity: "error",
          sourceId: input.descriptor.id,
          message: "Failed to parse JSON source. Exception details were omitted from diagnostics."
        }
      ]
    };
  }
}

function collectJsonLocations(sourceId: string, sourcePath: string, raw: string) {
  const locations = new Map<string, NonNullable<LoadedSource["locations"]>[number]>();
  const add = (path: JSONPath, line: number, column: number) => {
    if (path.length === 0 || path.some((segment) => typeof segment === "number")) return;
    locations.set(JSON.stringify(path), {
      path: [...path],
      location: { sourceId, sourcePath, line: line + 1, column: column + 1 }
    });
  };
  visit(raw, {
    onObjectBegin: (_offset, _length, line, column, path) => add(path(), line, column),
    onArrayBegin: (_offset, _length, line, column, path) => add(path(), line, column),
    onLiteralValue: (_value, _offset, _length, line, column, path) => add(path(), line, column)
  }, { disallowComments: true, allowTrailingComma: false });
  return [...locations.values()];
}
