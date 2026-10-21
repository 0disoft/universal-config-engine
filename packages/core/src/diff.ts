import { buildConfigInspection, configValueType, type BuildConfigInspectionOptions, type ConfigInspection, type ConfigInspectionEntry } from "./inspection.js";
import { getConfigValueAtPath, pathToKey } from "./path.js";
import { buildDiagnosticReport, type BuildDiagnosticReportOptions } from "./redaction.js";
import type { ConfigPath, ConfigResult, ConfigValue, ResolvedPath } from "./types.js";

export type ConfigChangeKind = "added" | "removed" | "type-changed" | "value-changed" | "source-changed";

export interface ConfigChange {
  readonly path: ConfigPath;
  readonly kinds: readonly ConfigChangeKind[];
  readonly before?: ConfigInspectionEntry;
  readonly after?: ConfigInspectionEntry;
}

export interface BuildConfigDiffOptions extends BuildConfigInspectionOptions {
  /** Explicitly disclose secret-change metadata; never retains values or fingerprints. */
  readonly detectSecretChanges?: boolean;
}

export interface ConfigDiff {
  readonly schemaVersion: "diff-1";
  readonly status: "ok" | "error";
  readonly secretComparison: "skipped" | "detected";
  readonly uncomparedSecretPaths: readonly ConfigPath[];
  readonly changes: readonly ConfigChange[];
  readonly before: ConfigInspection;
  readonly after: ConfigInspection;
  readonly error?: "input_failed" | "max_diff_entries_exceeded" | "max_report_bytes_exceeded";
}

export function buildConfigDiff(before: ConfigResult, after: ConfigResult, options: BuildConfigDiffOptions = {}): ConfigDiff {
  const maxBytes = Math.min(before.limits.maxReportBytes, after.limits.maxReportBytes);
  const policy = sharedRedaction(before, after, options);
  const inspectionOptions = { ...options, ...policy };
  const left = comparisonInspection(before, inspectionOptions);
  const right = comparisonInspection(after, inspectionOptions);
  const base: ConfigDiff = {
    schemaVersion: "diff-1", status: "ok", secretComparison: options.detectSecretChanges === true ? "detected" : "skipped",
    uncomparedSecretPaths: [], changes: [], before: left, after: right
  };
  if (left.status === "ok" && right.status === "ok" && !left.found && !right.found) {
    return diffFailure({ ...base, before: { ...left, status: "error", diagnostics: {
      ...left.diagnostics, status: "error", issues: [{ category: "usage", code: "inspection_path_not_found",
        severity: "error", message: "The selected config path does not exist on either side." }]
    } } }, "input_failed", maxBytes);
  }
  if (left.status === "error" || right.status === "error" || !left.found && !right.found) {
    return diffFailure(base, "input_failed", maxBytes);
  }
  const leftIndex = new Map(left.entries.map((entry) => [pathToKey(entry.path), entry]));
  const rightIndex = new Map(right.entries.map((entry) => [pathToKey(entry.path), entry]));
  const keys = [...new Set([...leftIndex.keys(), ...rightIndex.keys()])].sort();
  if (keys.length > Math.min(before.limits.maxResolvedPaths, after.limits.maxResolvedPaths)) {
    return diffFailure(base, "max_diff_entries_exceeded", maxBytes);
  }
  const changes: ConfigChange[] = [];
  const uncomparedSecretPaths: ConfigPath[] = [];
  const leftSources = sourceIdentities(before, left.entries);
  const rightSources = sourceIdentities(after, right.entries);
  for (const key of keys) {
    const previous = leftIndex.get(key);
    const next = rightIndex.get(key);
    const path = (next ?? previous)!.path;
    const kinds: ConfigChangeKind[] = [];
    if (previous === undefined) kinds.push("added");
    else if (next === undefined) kinds.push("removed");
    else {
      if (previous.type !== next.type) kinds.push("type-changed");
      const secret = previous.visibility === "redacted" || next.visibility === "redacted";
      if (secret && options.detectSecretChanges !== true) uncomparedSecretPaths.push(path);
      else if (previous.type === next.type && (secret || previous.visibility === "visible") &&
        !configValuesEqual(getConfigValueAtPath(before.config, path)!, getConfigValueAtPath(after.config, path)!)) {
        kinds.push("value-changed");
      }
      if (leftSources.get(previous) !== rightSources.get(next)) kinds.push("source-changed");
    }
    if (kinds.length > 0) changes.push({ path: [...path], kinds,
      ...(previous === undefined ? {} : { before: previous }), ...(next === undefined ? {} : { after: next }) });
  }
  const report = { ...base, changes, uncomparedSecretPaths };
  return new TextEncoder().encode(JSON.stringify(report)).byteLength <= maxBytes
    ? report : diffFailure(base, "max_report_bytes_exceeded", maxBytes);
}

function sharedRedaction(before: ConfigResult, after: ConfigResult, options: BuildDiagnosticReportOptions): BuildDiagnosticReportOptions {
  const sources = [...before.sources, ...after.sources];
  const combined = { ...options, secretSourceIds: [...new Set([
    ...(options.secretSourceIds ?? []), ...sources.filter((source) => source.redaction?.secretSource === true).map((source) => source.id)
  ])] };
  const paths = [before, after].flatMap((result) => buildDiagnosticReport(result, combined).resolvedPaths
    .filter((entry) => entry.redacted).map((entry) => entry.path));
  return {
    ...combined,
    secretPaths: [...(options.secretPaths ?? []), ...sources.flatMap((source) => source.redaction?.secretPaths ?? []), ...paths],
    secretNamePatterns: [...(options.secretNamePatterns ?? []), ...sources.flatMap((source) => source.redaction?.secretNamePatterns ?? [])]
  };
}

function comparisonInspection(result: ConfigResult, options: BuildConfigInspectionOptions): ConfigInspection {
  const report = buildConfigInspection(result, options);
  // An absent path on one side is an addition/removal, not an invalid comparison.
  if (result.ok && report.diagnostics.issues.length === 1 && report.diagnostics.issues[0]?.code === "inspection_path_not_found") {
    return { ...report, status: "ok", diagnostics: { ...report.diagnostics, status: "ok", issues: [] } };
  }
  return report;
}

function sourceIdentities(result: ConfigResult, entries: readonly ConfigInspectionEntry[]): ReadonlyMap<ConfigInspectionEntry, string> {
  const priorities = new Map(result.sources.map(source => [source.id, source.priority]));
  const identities = new Map<ConfigInspectionEntry, string>();
  const opaque = new Map<string, { entry: ConfigInspectionEntry; children: string[] }>();
  const identity = (source: Pick<ResolvedPath, "winningSourceId" | "overriddenSourceIds" | "winningLocation" | "overriddenLocations">) =>
    JSON.stringify([source.winningSourceId, priorities.get(source.winningSourceId),
      source.overriddenSourceIds.map(id => [id, priorities.get(id)]), source.winningLocation, source.overriddenLocations]);
  for (const entry of entries) {
    identities.set(entry, entry.source === undefined ? "" : identity(entry.source));
    if (entry.visibility === "redacted" && entry.type === "object" && entry.source === undefined) {
      opaque.set(pathToKey(entry.path), { entry, children: [] });
    }
  }
  // Display stays opaque; compare retained ownership underneath it in memory.
  // Prefix lookup avoids rescanning every resolved path for each secret object.
  if (opaque.size > 0) for (const source of result.resolvedPaths) {
    const owner = identity(source);
    for (let length = 0; length <= source.path.length; length += 1) {
      opaque.get(pathToKey(source.path.slice(0, length)))?.children.push(
        JSON.stringify([source.path.slice(length), owner]));
    }
  }
  for (const { entry, children } of opaque.values()) identities.set(entry, JSON.stringify(children.sort()));
  return identities;
}

/** Iterative and order-insensitive for objects; arrays retain positional semantics. */
export function configValuesEqual(left: ConfigValue, right: ConfigValue): boolean {
  const pending: [ConfigValue, ConfigValue][] = [[left, right]];
  while (pending.length > 0) {
    const [a, b] = pending.pop()!;
    if (a === b) continue;
    if (configValueType(a) !== configValueType(b) || a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
    const aKeys = Object.keys(a);
    if (aKeys.length !== Object.keys(b).length) return false;
    const aRecord = a as Readonly<Record<string, ConfigValue>>;
    const bRecord = b as Readonly<Record<string, ConfigValue>>;
    for (const key of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      pending.push([aRecord[key]!, bRecord[key]!]);
    }
  }
  return true;
}

/** Internal shared failure envelope for comparison and policy byte budgets. */
export function diffFailure(base: ConfigDiff, error: NonNullable<ConfigDiff["error"]>, maxBytes: number): ConfigDiff {
  // Drop both value-bearing sides on failure; keep their sanitized diagnostics.
  const failure: ConfigDiff = { ...base, status: "error", error, changes: [], uncomparedSecretPaths: [],
    before: { ...base.before, entries: [] }, after: { ...base.after, entries: [] } };
  if (new TextEncoder().encode(JSON.stringify(failure)).byteLength <= maxBytes) return failure;
  const compact = (side: ConfigInspection): ConfigInspection => ({
    ...side, status: "error", path: [], entries: [], diagnostics: {
      ...side.diagnostics, status: "error", sources: [], resolvedPaths: [], provenance: [],
      issues: [{ category: "resource-limit", code: "max_report_bytes_exceeded", severity: "error", message: "Diff exceeded its byte budget." }]
    }
  });
  return { ...failure, error: "max_report_bytes_exceeded", before: compact(base.before), after: compact(base.after) };
}
