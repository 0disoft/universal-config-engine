import { isConfigPath, isRecord } from "./adapter-guards.js";
import { pathToKey } from "./path.js";
import type { ResourceLimitPolicy, ValueLocation } from "./types.js";

/** Optional positions may be omitted; malformed adapter output must still fail. */
export function normalizeLoaderLocations(raw: unknown[], sourceId: string, limits: ResourceLimitPolicy) {
  const retained = new Map<string, { entry: ValueLocation; bytes: number }>();
  let bytes = 0;
  let omitted = false;
  for (const value of raw) {
    if (!isValueLocation(value)) return { ok: false as const };
    if (omitted) continue;
    // A string's UTF-16 length is a lower bound on its JSON UTF-8 size.
    // Check before serializing so a single huge path cannot allocate a huge copy.
    const characters = sourceId.length + (value.location.sourcePath?.length ?? 0) +
      value.path.reduce<number>((sum, segment) => sum + (typeof segment === "string" ? segment.length : 0), 0);
    if (value.path.length > limits.maxPathLength || characters > limits.maxReportBytes) {
      omitted = true; retained.clear(); continue;
    }
    const key = pathToKey(value.path);
    const previous = retained.get(key);
    if (previous === undefined && retained.size >= limits.maxResolvedPaths) {
      omitted = true; retained.clear(); continue;
    }
    const entry: ValueLocation = {
      path: previous?.entry.path ?? [...value.path],
      location: {
        sourceId,
        ...(value.location.sourcePath === undefined ? {} : { sourcePath: value.location.sourcePath }),
        ...(value.location.line === undefined ? {} : { line: value.location.line }),
        ...(value.location.column === undefined ? {} : { column: value.location.column })
      }
    };
    const size = new TextEncoder().encode(JSON.stringify(entry)).byteLength;
    const nextBytes = bytes - (previous?.bytes ?? 0) + size;
    if (nextBytes > limits.maxReportBytes) {
      omitted = true; retained.clear(); continue;
    }
    retained.set(key, { entry, bytes: size });
    bytes = nextBytes;
  }
  return { ok: true as const, locations: [...retained.values()].map(value => value.entry), omitted };
}

function isValueLocation(value: unknown): value is ValueLocation {
  if (!isRecord(value) || !isConfigPath(value.path) || !isRecord(value.location)) return false;
  const location = value.location;
  return typeof location.sourceId === "string" &&
    (location.sourcePath === undefined || typeof location.sourcePath === "string") &&
    (location.line === undefined || isPositiveSafeInteger(location.line)) &&
    (location.column === undefined || isPositiveSafeInteger(location.column));
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
