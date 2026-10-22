import { pathToKey } from "./path.js";
import { compileRedaction } from "./compiled-redaction.js";
import type {
  ConfigIssue,
  ConfigPath,
  ConfigResult,
  ConfigSourceDescriptor,
  DiagnosticReport,
  DiagnosticReportResolvedPath,
  ProvenanceEvent,
  ResolvedPath
} from "./types.js";

export const DEFAULT_SECRET_NAME_PATTERNS: readonly string[] = [
  "password",
  "secret",
  "token",
  "api_key",
  "api-key",
  "apikey",
  "credential"
];

export interface BuildDiagnosticReportOptions {
  readonly secretPaths?: readonly ConfigPath[];
  readonly secretSourceIds?: readonly string[];
  readonly secretNamePatterns?: readonly string[];
}

interface RedactionContext {
  readonly secretSourceIds: ReadonlySet<string>;
  readonly anySourceRedactionCache: Map<string, RedactionDecision>;
  readonly redactPath: (path: ConfigPath) => RedactionDecision;
}

export interface RedactionDecision {
  readonly redacted: boolean;
  readonly reason?: string;
}

export function buildDiagnosticReport(
  result: ConfigResult,
  options: BuildDiagnosticReportOptions = {}
): DiagnosticReport {
  const ownershipFailure = incompleteOwnershipFailure(result);
  if (ownershipFailure !== undefined) {
    return {
      schemaVersion: "0.2", status: "error", sources: [], resolvedPaths: [], provenance: [],
      issues: [{ category: "resource-limit", code: ownershipFailure, severity: "error",
        message: "Resolved path ownership is incomplete; diagnostic content was omitted." }],
      limits: { ...result.limits }
    };
  }
  const { sourceById, redactionContext } = createRedactionState(result, options);
  return buildReport(result, sourceById, redactionContext);
}

/** Internal shared policy boundary for value-bearing opt-in reports. */
export function createPathRedactor(
  result: ConfigResult,
  options: BuildDiagnosticReportOptions = {}
): (path: ConfigPath) => RedactionDecision {
  if (incompleteOwnershipFailure(result) !== undefined) return () => ({ redacted: true, reason: "incomplete-ownership" });
  const { sourceById, redactionContext } = createRedactionState(result, options);
  return (path) => getRedactionForAnySource(path, sourceById, redactionContext);
}

function incompleteOwnershipFailure(result: ConfigResult): string | undefined {
  const overflow = result.issues.find(issue => issue.category === "resource-limit" && issue.severity === "error" &&
    (issue.code === "max_resolved_paths_exceeded" ||
      // Diagnostic truncation can replace the ownership-limit error. At a full
      // path budget, fail closed rather than treating uncertain ownership as public.
      issue.code === "max_diagnostics_exceeded" && result.resolvedPaths.length >= result.limits.maxResolvedPaths));
  return overflow?.code;
}

function createRedactionState(result: ConfigResult, options: BuildDiagnosticReportOptions) {
  const sourceById = new Map(result.sources.map((source) => [source.id, source]));
  const secretSourceIds = new Set([
    ...(options.secretSourceIds ?? []),
    ...result.sources.filter((source) => source.redaction?.secretSource === true).map((source) => source.id)
  ]);
  const redactionContext: RedactionContext = {
    secretSourceIds,
    redactPath: compileRedaction(sourceById.values(), options, DEFAULT_SECRET_NAME_PATTERNS,
      result.resolvedPaths
        .filter((path) =>
          secretSourceIds.has(path.winningSourceId) ||
          path.overriddenSourceIds.some((id) => secretSourceIds.has(id))
        )
        .map((path) => path.path)
    ),
    anySourceRedactionCache: new Map()
  };
  return { sourceById, redactionContext };
}

function buildReport(
  result: ConfigResult,
  sourceById: ReadonlyMap<string, ConfigSourceDescriptor>,
  redactionContext: RedactionContext
): DiagnosticReport {
  const sourceIdsWithErrors = new Set(
    result.issues
      .filter((issue) => issue.severity === "error" && issue.sourceId !== undefined)
      .map((issue) => issue.sourceId as string)
  );

  const report: DiagnosticReport = {
    schemaVersion: "0.2",
    status: result.ok ? "ok" : "error",
    sources: result.sources.map((source) => ({
      id: source.id,
      kind: source.kind,
      displayName: source.displayName,
      priority: source.priority,
      status: sourceIdsWithErrors.has(source.id) ? "failed" : "loaded"
    })),
    resolvedPaths: result.resolvedPaths.map((resolvedPath) =>
      buildResolvedPathReport(resolvedPath, sourceById, redactionContext)
    ),
    issues: result.issues.map((issue) => sanitizeIssue(issue, sourceById, redactionContext)),
    provenance: result.provenance.map((event) => sanitizeProvenance(event, sourceById, redactionContext)),
    limits: { ...result.limits }
  };
  if (new TextEncoder().encode(JSON.stringify(report)).byteLength <= result.limits.maxReportBytes) {
    return report;
  }
  return {
    schemaVersion: "0.2",
    status: "error",
    sources: [],
    resolvedPaths: [],
    issues: [{
      category: "resource-limit",
      code: "max_report_bytes_exceeded",
      severity: "error",
      message: `Diagnostic report exceeded the maximum of ${result.limits.maxReportBytes} bytes.`
    }],
    provenance: [],
    limits: { ...result.limits }
  };
}

function buildResolvedPathReport(
  resolvedPath: ResolvedPath,
  sourceById: ReadonlyMap<string, ConfigSourceDescriptor>,
  redactionContext: RedactionContext
): DiagnosticReportResolvedPath {
  const redaction = getRedactionForAnySource(resolvedPath.path, sourceById, redactionContext);

  return {
    path: [...resolvedPath.path],
    status: "resolved",
    winningSourceId: resolvedPath.winningSourceId,
    overriddenSourceIds: [...resolvedPath.overriddenSourceIds],
    ...(resolvedPath.winningLocation === undefined ? {} : { winningLocation: { ...resolvedPath.winningLocation } }),
    ...(resolvedPath.overriddenLocations === undefined ? {} : {
      overriddenLocations: resolvedPath.overriddenLocations.map(location => ({ ...location }))
    }),
    redacted: redaction.redacted,
    ...(redaction.redacted ? { redactionReason: redaction.reason ?? "secret" } : {})
  };
}

function sanitizeIssue(
  issue: ConfigIssue,
  sourceById: ReadonlyMap<string, ConfigSourceDescriptor>,
  redactionContext: RedactionContext
): ConfigIssue {
  if (!shouldSanitizeDiagnostic(issue, sourceById, redactionContext)) {
    return {
      ...issue,
      ...(issue.path === undefined ? {} : { path: [...issue.path] }),
      ...(issue.details === undefined ? {} : { details: { ...issue.details } })
    };
  }

  return {
    category: issue.category,
    code: issue.code,
    severity: issue.severity,
    ...(issue.path === undefined ? {} : { path: [...issue.path] }),
    ...(issue.sourceId === undefined ? {} : { sourceId: issue.sourceId }),
    message: "Diagnostic message redacted because it is associated with a secret path or source."
  };
}

function sanitizeProvenance(
  event: ProvenanceEvent,
  sourceById: ReadonlyMap<string, ConfigSourceDescriptor>,
  redactionContext: RedactionContext
): ProvenanceEvent {
  if (!shouldSanitizeDiagnostic(event, sourceById, redactionContext)) {
    return { ...event, path: [...event.path] };
  }

  return {
    path: [...event.path],
    action: event.action,
    sourceId: event.sourceId,
    ...(event.previousSourceId === undefined ? {} : { previousSourceId: event.previousSourceId }),
    message: "Provenance message redacted because it is associated with a secret path or source."
  };
}

function shouldSanitizeDiagnostic(
  diagnostic: Pick<ConfigIssue, "path" | "sourceId"> & { readonly previousSourceId?: string },
  sourceById: ReadonlyMap<string, ConfigSourceDescriptor>,
  redactionContext: RedactionContext
): boolean {
  const { path, sourceId, previousSourceId } = diagnostic;
  if (
    (sourceId !== undefined && redactionContext.secretSourceIds.has(sourceId)) ||
    (previousSourceId !== undefined && redactionContext.secretSourceIds.has(previousSourceId))
  ) {
    return true;
  }

  return path === undefined ? false : getRedactionForAnySource(path, sourceById, redactionContext).redacted;
}

function getRedactionForAnySource(
  path: ConfigPath,
  _sourceById: ReadonlyMap<string, ConfigSourceDescriptor>,
  redactionContext: RedactionContext
): RedactionDecision {
  const key = pathToKey(path);
  const cached = redactionContext.anySourceRedactionCache.get(key);
  if (cached !== undefined) return cached;
  const decision = redactionContext.redactPath(path);
  redactionContext.anySourceRedactionCache.set(key, decision);
  return decision;
}
