import { isPathPrefix, pathToKey } from "./path.js";
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
  readonly options: BuildDiagnosticReportOptions;
  readonly secretSourceIds: ReadonlySet<string>;
  readonly secretSourcePaths: ReadonlySet<string>;
  readonly patternCache: Map<string, PatternMatcher>;
  readonly anySourceRedactionCache: Map<string, RedactionDecision>;
}

interface PatternMatcher {
  readonly rawLower: string;
}

export interface RedactionDecision {
  readonly redacted: boolean;
  readonly reason?: string;
}

export function buildDiagnosticReport(
  result: ConfigResult,
  options: BuildDiagnosticReportOptions = {}
): DiagnosticReport {
  const { sourceById, redactionContext } = createRedactionState(result, options);
  return buildReport(result, sourceById, redactionContext);
}

/** Internal shared policy boundary for value-bearing opt-in reports. */
export function createPathRedactor(
  result: ConfigResult,
  options: BuildDiagnosticReportOptions = {}
): (path: ConfigPath) => RedactionDecision {
  const { sourceById, redactionContext } = createRedactionState(result, options);
  return (path) => getRedactionForAnySource(path, sourceById, redactionContext);
}

function createRedactionState(result: ConfigResult, options: BuildDiagnosticReportOptions) {
  const sourceById = new Map(result.sources.map((source) => [source.id, source]));
  const secretSourceIds = new Set([
    ...(options.secretSourceIds ?? []),
    ...result.sources.filter((source) => source.redaction?.secretSource === true).map((source) => source.id)
  ]);
  const redactionContext: RedactionContext = {
    options,
    secretSourceIds,
    secretSourcePaths: new Set(
      result.resolvedPaths
        .filter((path) =>
          secretSourceIds.has(path.winningSourceId) ||
          path.overriddenSourceIds.some((id) => secretSourceIds.has(id))
        )
        .map((path) => pathToKey(path.path))
    ),
    patternCache: new Map(),
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
    limits: result.limits
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
    limits: result.limits
  };
}

function buildResolvedPathReport(
  resolvedPath: ResolvedPath,
  sourceById: ReadonlyMap<string, ConfigSourceDescriptor>,
  redactionContext: RedactionContext
): DiagnosticReportResolvedPath {
  const redaction = getRedactionForAnySource(resolvedPath.path, sourceById, redactionContext);

  if (redaction.redacted) {
    return {
      path: resolvedPath.path,
      status: "resolved",
      winningSourceId: resolvedPath.winningSourceId,
      overriddenSourceIds: resolvedPath.overriddenSourceIds,
      ...(resolvedPath.winningLocation === undefined ? {} : { winningLocation: resolvedPath.winningLocation }),
      ...(resolvedPath.overriddenLocations === undefined ? {} : { overriddenLocations: resolvedPath.overriddenLocations }),
      redacted: true,
      redactionReason: redaction.reason ?? "secret"
    };
  }

  return {
    path: resolvedPath.path,
    status: "resolved",
    winningSourceId: resolvedPath.winningSourceId,
    overriddenSourceIds: resolvedPath.overriddenSourceIds,
    ...(resolvedPath.winningLocation === undefined ? {} : { winningLocation: resolvedPath.winningLocation }),
    ...(resolvedPath.overriddenLocations === undefined ? {} : { overriddenLocations: resolvedPath.overriddenLocations }),
    redacted: false
  };
}

function sanitizeIssue(
  issue: ConfigIssue,
  sourceById: ReadonlyMap<string, ConfigSourceDescriptor>,
  redactionContext: RedactionContext
): ConfigIssue {
  if (!shouldSanitizeDiagnostic(issue, sourceById, redactionContext)) {
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
  redactionContext: RedactionContext
): ProvenanceEvent {
  if (!shouldSanitizeDiagnostic(event, sourceById, redactionContext)) {
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
  sourceById: ReadonlyMap<string, ConfigSourceDescriptor>,
  redactionContext: RedactionContext
): RedactionDecision {
  const cacheKey = pathToKey(path);
  const cached = redactionContext.anySourceRedactionCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  if (redactionContext.secretSourcePaths.has(cacheKey)) {
    const redaction = { redacted: true, reason: "secret-source" };
    redactionContext.anySourceRedactionCache.set(cacheKey, redaction);
    return redaction;
  }

  for (const source of sourceById.values()) {
    // Explicit path/name policies apply across diagnostics; a whole-source policy
    // only applies to diagnostics tied to that source or its resolved path history.
    const redaction = getPathRedaction(path, source, redactionContext);
    if (redaction.redacted) {
      redactionContext.anySourceRedactionCache.set(cacheKey, redaction);
      return redaction;
    }
  }

  const fallback = getPathRedaction(path, undefined, redactionContext);
  redactionContext.anySourceRedactionCache.set(cacheKey, fallback);
  return fallback;
}

function getPathRedaction(
  path: ConfigPath,
  source: ConfigSourceDescriptor | undefined,
  redactionContext: RedactionContext
): RedactionDecision {
  if (matchesAnyPath(path, source?.redaction) || matchesAnyPath(path, redactionContext.options)) {
    return { redacted: true, reason: "secret-path" };
  }

  if (
    matchesNamePattern(path, source?.redaction?.secretNamePatterns, redactionContext) ||
    matchesNamePattern(path, redactionContext.options.secretNamePatterns, redactionContext)
  ) {
    return { redacted: true, reason: "secret-name" };
  }

  if (matchesNamePattern(path, DEFAULT_SECRET_NAME_PATTERNS, redactionContext)) {
    return { redacted: true, reason: "secret-name" };
  }

  return { redacted: false };
}

function matchesAnyPath(
  path: ConfigPath,
  policy: Pick<RedactionPolicyInput, "secretPaths"> | Pick<BuildDiagnosticReportOptions, "secretPaths"> | undefined
): boolean {
  return policy?.secretPaths?.some((secretPath) => isPathPrefix(secretPath, path)) ?? false;
}

function matchesNamePattern(
  path: ConfigPath,
  patterns: readonly string[] | undefined,
  redactionContext: RedactionContext
): boolean {
  if (patterns === undefined || patterns.length === 0) {
    return false;
  }

  const pathName = path.map(String).join(".");
  const lastSegment = String(path[path.length - 1] ?? "");

  return patterns.some(
    (pattern) =>
      safePatternMatches(pattern, pathName, redactionContext) ||
      safePatternMatches(pattern, lastSegment, redactionContext)
  );
}

function safePatternMatches(pattern: string, value: string, redactionContext: RedactionContext): boolean {
  const matcher = getPatternMatcher(pattern, redactionContext.patternCache);
  return value.toLowerCase().includes(matcher.rawLower);
}

function getPatternMatcher(pattern: string, patternCache: Map<string, PatternMatcher>): PatternMatcher {
  const cached = patternCache.get(pattern);
  if (cached !== undefined) {
    return cached;
  }

  const matcher = compilePatternMatcher(pattern);
  patternCache.set(pattern, matcher);
  return matcher;
}

function compilePatternMatcher(pattern: string): PatternMatcher {
  return {
    rawLower: pattern.toLowerCase()
  };
}
