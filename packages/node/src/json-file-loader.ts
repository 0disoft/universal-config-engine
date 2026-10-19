import type { ConfigSourceDescriptor, LoadedSource } from "@0disoft/universal-config-engine-core";
import { visit, type JSONPath } from "jsonc-parser";
import type { FileReadPolicy } from "./file.js";
import { loadTextFileSource } from "./file-source.js";

export interface LoadJsonFileSourceInput extends FileReadPolicy {
  readonly descriptor: ConfigSourceDescriptor;
  readonly filePath: string;
}

export async function loadJsonFileSource(input: LoadJsonFileSourceInput): Promise<LoadedSource> {
  return loadTextFileSource(input, {
    readFailure: {
      category: "source-load",
      code: "json_read_failed",
      message: "Failed to read JSON source. Exception details were omitted from diagnostics."
    },
    parseFailure: {
      category: "parse",
      code: "json_parse_failed",
      message: "Failed to parse JSON source. Exception details were omitted from diagnostics."
    },
    parse: (raw, canonicalPath) => ({
      descriptor: input.descriptor,
      value: JSON.parse(raw) as unknown,
      locations: collectJsonLocations(input.descriptor.id, canonicalPath, raw)
    })
  });
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
