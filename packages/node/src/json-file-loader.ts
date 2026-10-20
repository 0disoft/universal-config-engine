import type { ConfigSourceDescriptor, LoadedSource } from "@0disoft/universal-config-engine-core";
import { createScanner } from "jsonc-parser";
import type { FileReadPolicy } from "./file.js";
import { loadTextFileSource } from "./file-source.js";

// jsonc-parser's ambient const enum cannot be imported with verbatimModuleSyntax.
// These are its stable scanner token IDs, not a separate syntax validator.
const TOKEN = { objectBegin: 1, objectEnd: 2, arrayBegin: 3, arrayEnd: 4,
  comma: 5, colon: 6, string: 10, eof: 17 } as const;

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
  const scanner = createScanner(raw, true);
  const path: string[] = [];
  const expectingKeys: boolean[] = [];
  let skippedArrayDepth = 0;
  const add = () => {
    if (path.length === 0) return;
    locations.set(JSON.stringify(path), {
      path: [...path],
      location: { sourceId, sourcePath, line: scanner.getTokenStartLine() + 1,
        column: scanner.getTokenStartCharacter() + 1 }
    });
  };
  // JSON.parse already owns syntax validation. Scan positions without the
  // recursive visitor, and skip array contents: they have no retained locations.
  for (let token = scanner.scan(); token !== TOKEN.eof; token = scanner.scan()) {
    const open = token === TOKEN.objectBegin || token === TOKEN.arrayBegin;
    const close = token === TOKEN.objectEnd || token === TOKEN.arrayEnd;
    if (skippedArrayDepth > 0) {
      if (open) skippedArrayDepth += 1;
      if (close) skippedArrayDepth -= 1;
      if (skippedArrayDepth === 0 && expectingKeys.length > 0) path.pop();
      continue;
    }
    if (token === TOKEN.string && expectingKeys[expectingKeys.length - 1] === true) {
      path.push(scanner.getTokenValue());
      expectingKeys[expectingKeys.length - 1] = false;
    } else if (token === TOKEN.objectBegin) {
      add();
      expectingKeys.push(true);
    } else if (token === TOKEN.objectEnd) {
      expectingKeys.pop();
      if (expectingKeys.length > 0) path.pop();
    } else if (token === TOKEN.arrayBegin) {
      add();
      skippedArrayDepth = 1;
    } else if (token === TOKEN.comma) {
      expectingKeys[expectingKeys.length - 1] = true;
    } else if (token !== TOKEN.colon) {
      add();
      if (expectingKeys.length > 0) path.pop();
    }
  }
  return [...locations.values()];
}
