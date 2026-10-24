import { isRecord } from "./adapter-guards.js";

export interface ConfigComparisonOptions {
  /** Compare values and types; additions/removals are always reported. */
  readonly values?: boolean;
  /** Compare winning/overridden source IDs and priorities, independently of locations. */
  readonly sources?: boolean;
  /** Compare source paths, lines and columns. */
  readonly locations?: boolean;
}

export function normalizeComparisonOptions(value: unknown): Required<ConfigComparisonOptions> | undefined {
  if (value === undefined) return { values: true, sources: true, locations: true };
  try {
    if (!isRecord(value) || Object.keys(value).some(key => !["values", "sources", "locations"].includes(key))) return undefined;
    const field = (name: string) => Object.hasOwn(value, name) ? value[name] : undefined;
    const values = field("values"), sources = field("sources"), locations = field("locations");
    const normalized = { values: values === undefined ? true : values,
      sources: sources === undefined ? true : sources, locations: locations === undefined ? true : locations };
    if (Object.values(normalized).some(flag => typeof flag !== "boolean") || !Object.values(normalized).some(Boolean)) return undefined;
    return normalized as Required<ConfigComparisonOptions>;
  } catch { return undefined; }
}
