import { isConfigPath } from "./adapter-guards.js";
import { getConfigValueAtPath, isPathPrefix, isUnsafePathSegment, pathToKey } from "./path.js";
import { buildDiagnosticReport, createPathRedactor, type BuildDiagnosticReportOptions } from "./redaction.js";
import type { ConfigPath, ConfigResult, ConfigScalar, ConfigValue, DiagnosticReport, DiagnosticReportResolvedPath } from "./types.js";

export type InspectedValueType = "null" | "string" | "number" | "boolean" | "object" | "array";

export interface ConfigInspectionEntry {
  readonly path: ConfigPath;
  readonly type: InspectedValueType;
  readonly visibility: "visible" | "redacted" | "container";
  readonly value?: ConfigScalar;
  readonly truncated?: boolean;
  readonly redactionReason?: string;
  readonly source?: DiagnosticReportResolvedPath;
}

export interface BuildConfigInspectionOptions extends BuildDiagnosticReportOptions {
  readonly path?: ConfigPath;
  /** Preview characters only; diff always compares the complete original value. */
  readonly maxValueLength?: number;
}

export interface ConfigInspection {
  readonly schemaVersion: "inspection-1";
  readonly status: "ok" | "error";
  readonly found: boolean;
  readonly path: ConfigPath;
  readonly entries: readonly ConfigInspectionEntry[];
  readonly diagnostics: DiagnosticReport;
}

export function buildConfigInspection(
  result: ConfigResult,
  options: BuildConfigInspectionOptions = {}
): ConfigInspection {
  const path = options.path ?? [];
  let diagnostics = buildDiagnosticReport(result, options);
  if (!Array.isArray(path) || path.length > result.limits.maxPathLength || !isConfigPath(path) || path.some(isUnsafePathSegment)) {
    return inspectionFailure(diagnostics, [], "invalid_inspection_path", "Inspection requires a safe typed config path.");
  }
  diagnostics = {
    ...diagnostics,
    resolvedPaths: diagnostics.resolvedPaths.filter((entry) => pathsIntersect(path, entry.path)),
    issues: diagnostics.issues.filter((issue) => issue.path === undefined || pathsIntersect(path, issue.path)),
    provenance: diagnostics.provenance.filter((event) => pathsIntersect(path, event.path))
  };
  const value = getConfigValueAtPath(result.config, path);
  const base: ConfigInspection = {
    schemaVersion: "inspection-1", status: diagnostics.status, found: value !== undefined,
    path: [...path], entries: [], diagnostics
  };
  // Failed resolution can contain partial values; never expose them as effective config.
  if (!result.ok || diagnostics.status === "error") return base;
  if (value === undefined) {
    return inspectionFailure(diagnostics, path, "inspection_path_not_found", "The selected config path does not exist.");
  }
  const maxValueLength = positiveLimit(options.maxValueLength, 1024);
  const redact = createPathRedactor(result, options);
  const sourceIndex = new Map(diagnostics.resolvedPaths.map((entry) => [pathToKey(entry.path), entry]));
  const entries: ConfigInspectionEntry[] = [];
  const pending: { path: ConfigPath; value: ConfigValue; source: DiagnosticReportResolvedPath | undefined }[] = [
    { path: [...path], value, source: closestSource(path, sourceIndex) }
  ];
  let entryBytes = 0;
  while (pending.length > 0) {
    const item = pending.pop()!;
    if (entries.length >= result.limits.maxResolvedPaths) {
      return inspectionFailure(diagnostics, path, "max_inspection_entries_exceeded", "Inspection exceeded its entry budget.");
    }
    const source = sourceIndex.get(pathToKey(item.path)) ?? item.source;
    const decision = source?.redacted
      ? { redacted: true, reason: source.redactionReason ?? "secret" }
      : redact(item.path);
    const type = configValueType(item.value);
    const container = item.value !== null && typeof item.value === "object";
    const scalar = container ? undefined : item.value as ConfigScalar;
    const truncated = typeof scalar === "string" && scalar.length > maxValueLength;
    const entry: ConfigInspectionEntry = {
      path: [...item.path], type,
      visibility: decision.redacted ? "redacted" : container ? "container" : "visible",
      ...(source === undefined ? {} : { source }),
      ...(decision.redacted ? { redactionReason: decision.reason ?? "secret" } :
        scalar === undefined ? {} : { value: typeof scalar === "string" && truncated ? scalar.slice(0, maxValueLength) : scalar }),
      ...(!decision.redacted && truncated ? { truncated: true } : {})
    };
    entryBytes += new TextEncoder().encode(JSON.stringify(entry)).byteLength;
    if (entryBytes > result.limits.maxReportBytes) {
      return inspectionFailure(diagnostics, path, "max_report_bytes_exceeded", "Inspection exceeded its byte budget.");
    }
    entries.push(entry);
    if (!container || decision.redacted) continue;
    const keys = Array.isArray(item.value) ? undefined : Object.keys(item.value as object);
    const childCount = Array.isArray(item.value) ? item.value.length : keys!.length;
    if (pending.length + childCount + entries.length > result.limits.maxResolvedPaths) {
      return inspectionFailure(diagnostics, path, "max_inspection_entries_exceeded", "Inspection exceeded its entry budget.");
    }
    const children = Array.isArray(item.value)
      ? item.value.map((child, index) => ({ path: [...item.path, index], value: child, source }))
      : keys!.map((key) => ({ path: [...item.path, key], value: (item.value as Readonly<Record<string, ConfigValue>>)[key]!, source }));
    for (const child of children.reverse()) pending.push(child);
  }
  const report = { ...base, entries };
  return new TextEncoder().encode(JSON.stringify(report)).byteLength <= result.limits.maxReportBytes
    ? report
    : inspectionFailure(diagnostics, path, "max_report_bytes_exceeded", "Inspection exceeded its byte budget.");
}

export function configValueType(value: ConfigValue): InspectedValueType {
  return value === null ? "null" : Array.isArray(value) ? "array" : typeof value as InspectedValueType;
}

function closestSource(path: ConfigPath, index: ReadonlyMap<string, DiagnosticReportResolvedPath>) {
  for (let length = path.length; length >= 0; length -= 1) {
    const source = index.get(pathToKey(path.slice(0, length)));
    if (source !== undefined) return source;
  }
  return undefined;
}

function positiveLimit(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function pathsIntersect(left: ConfigPath, right: ConfigPath) {
  return isPathPrefix(left, right) || isPathPrefix(right, left);
}

function inspectionFailure(diagnostics: DiagnosticReport, path: ConfigPath, code: string, message: string): ConfigInspection {
  const failure: ConfigInspection = {
    schemaVersion: "inspection-1", status: "error", found: false, path: [...path], entries: [],
    diagnostics: { ...diagnostics, status: "error", issues: [{
      category: code.startsWith("max_") ? "resource-limit" : "usage", code, severity: "error", message
    }] }
  };
  if (new TextEncoder().encode(JSON.stringify(failure)).byteLength <= diagnostics.limits.maxReportBytes) return failure;
  // A fixed error envelope, like diagnostic report overflow, can exceed a tiny limit.
  return { ...failure, path: [], diagnostics: { ...failure.diagnostics, sources: [], resolvedPaths: [], provenance: [] } };
}
