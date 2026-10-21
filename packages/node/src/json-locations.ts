import type { LoadedSource } from "@0disoft/universal-config-engine-core";
import { createScanner } from "jsonc-parser";

// Stable scanner token IDs; the parser owns syntax validation.
const TOKEN = { objectBegin: 1, objectEnd: 2, arrayBegin: 3, arrayEnd: 4,
  comma: 5, colon: 6, string: 10, eof: 17 } as const;

export function collectJsonLocations(
  sourceId: string, sourcePath: string, raw: string, maxLocationBytes: number
): Pick<LoadedSource, "locations" | "issues"> {
  const locations = new Map<string, { readonly entry: NonNullable<LoadedSource["locations"]>[number]; readonly bytes: number }>();
  const encoder = new TextEncoder();
  let locationBytes = 0;
  let exceeded = false;
  const scanner = createScanner(raw, true);
  const path: string[] = [];
  const expectingKeys: boolean[] = [];
  let skippedArrayDepth = 0;
  const add = () => {
    if (path.length === 0) return;
    const key = JSON.stringify(path);
    const entry = {
      path: [...path],
      location: { sourceId, sourcePath, line: scanner.getTokenStartLine() + 1,
        column: scanner.getTokenStartCharacter() + 1 }
    };
    const bytes = encoder.encode(JSON.stringify(entry)).byteLength;
    const nextBytes = locationBytes - (locations.get(key)?.bytes ?? 0) + bytes;
    if (nextBytes > maxLocationBytes) {
      exceeded = true;
      return;
    }
    locations.set(key, { entry, bytes });
    locationBytes = nextBytes;
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
    if (exceeded) break;
  }
  if (exceeded) {
    // A partial scan could attach stale coordinates to a later duplicate key.
    // Keep the already parsed config and omit all optional location metadata.
    return { locations: [], issues: [{ category: "resource-limit", code: "max_location_bytes_exceeded",
      severity: "warning", sourceId, message: "JSON source locations were omitted because their metadata exceeded the byte budget.",
      details: { maxLocationBytes } }] };
  }
  return { locations: [...locations.values()].map(({ entry }) => entry) };
}
