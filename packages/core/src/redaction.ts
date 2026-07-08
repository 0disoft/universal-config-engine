import { pathsEqual } from "./path.js";
import type {
  ConfigIssue,
  ConfigPath,
  ConfigResult,
  ConfigSourceDescriptor,
  DiagnosticReport,
  DiagnosticReportResolvedPath,
  ProvenanceEvent,
  RedactionPolicyInput,
  ResolvedPath
} from "./types.js";

export const DEFAULT_SECRET_NAME_PATTERNS: readonly string[] = [
  "password",
  "secret",
  "token",
  "api[_-]?key",
  "credential"
];

export interface BuildDiagnosticReportOptions {
  readonly secretPaths?: readonly ConfigPath[];
  readonly secretSourceIds?: readonly string[];
  readonly secretNamePatterns?: readonly string[];
}

export function buildDiagnosticReport(
  result: ConfigResult,
  options: BuildDiagnosticReportOptions = {}
): DiagnosticReport {
  const sourceById = new Map(result.sources.map((source) => [source.id, source]));
  const sourceIdsWithErrors = new Set(
    result.issues
      .filter((issue) => issue.severity === "error" && issue.sourceId !== undefined)
      .map((issue) => issue.sourceId as string)
  );

  return {
    schemaVersion: "0.1",
    status: result.ok ? "ok" : "error",
    sources: result.sources.map((source) => ({
      id: source.id,
      kind: source.kind,
      displayName: source.displayName,
      priority: source.priority,
      status: sourceIdsWithErrors.has(source.id) ? "failed" : "loaded"
    })),
    resolvedPaths: result.resolvedPaths.map((resolvedPath) =>
      buildResolvedPathReport(resolvedPath, sourceById, options)
    ),
    issues: result.issues.map((issue) => sanitizeIssue(issue, sourceById, options)),
    provenance: result.provenance.map((event) => sanitizeProvenance(event, sourceById, options)),
    limits: result.limits
  };
}

function buildResolvedPathReport(
  resolvedPath: ResolvedPath,
  sourceById: ReadonlyMap<string, ConfigSourceDescriptor>,
  options: BuildDiagnosticReportOptions
): DiagnosticReportResolvedPath {
  const winningSource = sourceById.get(resolvedPath.winningSourceId);
  const redaction = getRedaction(resolvedPath.path, winningSource, options);

  if (redaction.redacted) {
    return {
      path: resolvedPath.path,
      status: "resolved",
      winningSourceId: resolvedPath.winningSourceId,
      overriddenSourceIds: resolvedPath.overriddenSourceIds,
      redacted: true,
      redactionReason: redaction.reason ?? "secret"
    };
  }

  return {
    path: resolvedPath.path,
    status: "resolved",
    winningSourceId: resolvedPath.winningSourceId,
    overriddenSourceIds: resolvedPath.overriddenSourceIds,
    redacted: false
  };
}

function sanitizeIssue(
  issue: ConfigIssue,
  sourceById: ReadonlyMap<string, ConfigSourceDescriptor>,
  options: BuildDiagnosticReportOptions
): ConfigIssue {
  if (!shouldSanitizeDiagnostic(issue.path, issue.sourceId, sourceById, options)) {
    return issue;
  }

  return {
    category: issue.category,
    code: issue.code,
    severity: issue.severity,
    ...(issue.path === undefined ? {} : { path: issue.path }),
    ...(issue.sourceId === undefined ? {} : { sourceId: issue.sourceId }),
    message: "Diagnostic message redacted because it is associated with a secret path or source."
  };
}

function sanitizeProvenance(
  event: ProvenanceEvent,
  sourceById: ReadonlyMap<string, ConfigSourceDescriptor>,
  options: BuildDiagnosticReportOptions
): ProvenanceEvent {
  if (!shouldSanitizeDiagnostic(event.path, event.sourceId, sourceById, options)) {
    return event;
  }

  return {
    path: event.path,
    action: event.action,
    sourceId: event.sourceId,
    ...(event.previousSourceId === undefined ? {} : { previousSourceId: event.previousSourceId }),
    message: "Provenance message redacted because it is associated with a secret path or source."
  };
}

function shouldSanitizeDiagnostic(
  path: ConfigPath | undefined,
  sourceId: string | undefined,
  sourceById: ReadonlyMap<string, ConfigSourceDescriptor>,
  options: BuildDiagnosticReportOptions
): boolean {
  const source = sourceId === undefined ? undefined : sourceById.get(sourceId);
  if (source?.redaction?.secretSource === true || options.secretSourceIds?.includes(sourceId ?? "")) {
    return true;
  }

  return path === undefined ? false : getRedactionForAnySource(path, sourceById, options).redacted;
}

function getRedactionForAnySource(
  path: ConfigPath,
  sourceById: ReadonlyMap<string, ConfigSourceDescriptor>,
  options: BuildDiagnosticReportOptions
): { readonly redacted: boolean; readonly reason?: string } {
  for (const source of sourceById.values()) {
    const redaction = getRedaction(path, source, options);
    if (redaction.redacted) {
      return redaction;
    }
  }

  return getRedaction(path, undefined, options);
}

function getRedaction(
  path: ConfigPath,
  source: ConfigSourceDescriptor | undefined,
  options: BuildDiagnosticReportOptions
): { readonly redacted: boolean; readonly reason?: string } {
  if (source?.redaction?.secretSource === true || options.secretSourceIds?.includes(source?.id ?? "")) {
    return { redacted: true, reason: "secret-source" };
  }

  if (matchesAnyPath(path, source?.redaction) || matchesAnyPath(path, options)) {
    return { redacted: true, reason: "secret-path" };
  }

  if (matchesNamePattern(path, source?.redaction?.secretNamePatterns ?? options.secretNamePatterns)) {
    return { redacted: true, reason: "secret-name" };
  }

  if (matchesNamePattern(path, DEFAULT_SECRET_NAME_PATTERNS)) {
    return { redacted: true, reason: "secret-name" };
  }

  return { redacted: false };
}

function matchesAnyPath(
  path: ConfigPath,
  policy: Pick<RedactionPolicyInput, "secretPaths"> | Pick<BuildDiagnosticReportOptions, "secretPaths"> | undefined
): boolean {
  return policy?.secretPaths?.some((secretPath) => pathsEqual(path, secretPath)) ?? false;
}

function matchesNamePattern(path: ConfigPath, patterns: readonly string[] | undefined): boolean {
  if (patterns === undefined || patterns.length === 0) {
    return false;
  }

  const pathName = path.map(String).join(".");
  const lastSegment = String(path[path.length - 1] ?? "");

  return patterns.some((pattern) => safePatternMatches(pattern, pathName) || safePatternMatches(pattern, lastSegment));
}

function safePatternMatches(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern, "i").test(value);
  } catch {
    return value.toLowerCase().includes(pattern.toLowerCase());
  }
}
