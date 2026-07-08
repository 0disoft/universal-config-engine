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
  "api[_-]?key",
  "credential"
];

const MAX_SECRET_NAME_PATTERN_LENGTH = 128;
const MAX_REDACTION_MATCH_INPUT_LENGTH = 512;

export interface BuildDiagnosticReportOptions {
  readonly secretPaths?: readonly ConfigPath[];
  readonly secretSourceIds?: readonly string[];
  readonly secretNamePatterns?: readonly string[];
}

interface RedactionContext {
  readonly options: BuildDiagnosticReportOptions;
  readonly patternCache: Map<string, PatternMatcher>;
  readonly anySourceRedactionCache: Map<string, RedactionDecision>;
}

interface PatternMatcher {
  readonly rawLower: string;
  readonly regex?: RegExp;
}

interface RedactionDecision {
  readonly redacted: boolean;
  readonly reason?: string;
}

export function buildDiagnosticReport(
  result: ConfigResult,
  options: BuildDiagnosticReportOptions = {}
): DiagnosticReport {
  const sourceById = new Map(result.sources.map((source) => [source.id, source]));
  const redactionContext: RedactionContext = {
    options,
    patternCache: new Map(),
    anySourceRedactionCache: new Map()
  };
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
      buildResolvedPathReport(resolvedPath, sourceById, redactionContext)
    ),
    issues: result.issues.map((issue) => sanitizeIssue(issue, sourceById, redactionContext)),
    provenance: result.provenance.map((event) => sanitizeProvenance(event, sourceById, redactionContext)),
    limits: result.limits
  };
}

function buildResolvedPathReport(
  resolvedPath: ResolvedPath,
  sourceById: ReadonlyMap<string, ConfigSourceDescriptor>,
  redactionContext: RedactionContext
): DiagnosticReportResolvedPath {
  const winningSource = sourceById.get(resolvedPath.winningSourceId);
  const redaction = getRedaction(resolvedPath.path, winningSource, redactionContext);

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
  redactionContext: RedactionContext
): ConfigIssue {
  if (!shouldSanitizeDiagnostic(issue.path, issue.sourceId, sourceById, redactionContext)) {
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
  if (!shouldSanitizeDiagnostic(event.path, event.sourceId, sourceById, redactionContext)) {
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
  redactionContext: RedactionContext
): boolean {
  const source = sourceId === undefined ? undefined : sourceById.get(sourceId);
  if (source?.redaction?.secretSource === true || redactionContext.options.secretSourceIds?.includes(sourceId ?? "")) {
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

  for (const source of sourceById.values()) {
    const redaction = getRedaction(path, source, redactionContext);
    if (redaction.redacted) {
      redactionContext.anySourceRedactionCache.set(cacheKey, redaction);
      return redaction;
    }
  }

  const fallback = getRedaction(path, undefined, redactionContext);
  redactionContext.anySourceRedactionCache.set(cacheKey, fallback);
  return fallback;
}

function getRedaction(
  path: ConfigPath,
  source: ConfigSourceDescriptor | undefined,
  redactionContext: RedactionContext
): RedactionDecision {
  if (source?.redaction?.secretSource === true || redactionContext.options.secretSourceIds?.includes(source?.id ?? "")) {
    return { redacted: true, reason: "secret-source" };
  }

  if (matchesAnyPath(path, source?.redaction) || matchesAnyPath(path, redactionContext.options)) {
    return { redacted: true, reason: "secret-path" };
  }

  if (matchesNamePattern(path, source?.redaction?.secretNamePatterns ?? redactionContext.options.secretNamePatterns, redactionContext)) {
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
  const matchInput = boundPatternInput(value);

  if (matcher.regex !== undefined) {
    return matcher.regex.test(matchInput);
  }

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
  const rawLower = pattern.toLowerCase();
  if (pattern.length > MAX_SECRET_NAME_PATTERN_LENGTH || hasNestedQuantifier(pattern)) {
    return { rawLower };
  }

  try {
    return {
      rawLower,
      regex: new RegExp(pattern, "i")
    };
  } catch {
    return { rawLower };
  }
}

function hasNestedQuantifier(pattern: string): boolean {
  return /\([^)]*[+*{][^)]*\)[+*{]/.test(pattern);
}

function boundPatternInput(value: string): string {
  if (value.length <= MAX_REDACTION_MATCH_INPUT_LENGTH) {
    return value;
  }

  const half = MAX_REDACTION_MATCH_INPUT_LENGTH / 2;
  return `${value.slice(0, half)}${value.slice(-half)}`;
}
