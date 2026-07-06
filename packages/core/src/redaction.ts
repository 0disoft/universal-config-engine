import { pathsEqual } from "./path.js";
import type {
  ConfigPath,
  ConfigResult,
  ConfigSourceDescriptor,
  DiagnosticReport,
  DiagnosticReportResolvedPath,
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
    issues: result.issues,
    provenance: result.provenance,
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
