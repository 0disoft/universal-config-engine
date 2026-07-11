import type {
  ConfigIssue,
  ConfigLoader,
  ConfigLoaderResult,
  ConfigPath,
  LoadedSource,
  ResourceLimitPolicy,
  ValueLocation
} from "./types.js";
import { normalizeResourceLimits } from "./limits.js";

const ISSUE_CATEGORIES = new Set([
  "usage",
  "source-load",
  "parse",
  "mapping",
  "merge",
  "coercion",
  "validation",
  "redaction",
  "resource-limit"
]);
const ISSUE_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;

export interface LoadConfigSourcesInput<TContext = undefined> {
  readonly loaders: readonly ConfigLoader<TContext>[];
  readonly context: TContext;
  readonly limits?: Partial<ResourceLimitPolicy>;
}

export interface LoadConfigSourcesResult {
  readonly sources: readonly LoadedSource[];
  readonly issues: readonly ConfigIssue[];
}

export async function loadConfigSources<TContext = undefined>(
  input: LoadConfigSourcesInput<TContext>
): Promise<LoadConfigSourcesResult> {
  const sources: LoadedSource[] = [];
  const issues: ConfigIssue[] = [];
  const maxDiagnostics = normalizeResourceLimits(input.limits).maxDiagnostics;

  for (const loader of input.loaders) {
    try {
      const result = await loader.load(input.context);
      const source = toLoadedSource(loader, result, maxDiagnostics);
      sources.push(source);
      pushBoundedIssues(issues, source.issues ?? [], maxDiagnostics);
    } catch {
      const issue = loaderThrewIssue(loader);
      const source: LoadedSource = {
        descriptor: loader.descriptor,
        value: {},
        issues: [issue]
      };
      sources.push(source);
      pushBoundedIssues(issues, [issue], maxDiagnostics);
    }
  }

  return {
    sources,
    issues
  };
}

function toLoadedSource<TContext>(
  loader: ConfigLoader<TContext>,
  result: ConfigLoaderResult,
  maxDiagnostics: number
): LoadedSource {
  const normalized = normalizeLoaderResult(loader, result);
  if (!normalized.ok) {
    return {
      descriptor: loader.descriptor,
      value: {},
      issues: [invalidLoaderResultIssue(loader)]
    };
  }
  const issues = boundIssues(normalized.issues, maxDiagnostics);
  return {
    descriptor: loader.descriptor,
    value: normalized.value,
    ...(normalized.locations === undefined ? {} : { locations: normalized.locations }),
    ...(normalized.hasIssuesField ? { issues } : {})
  };
}

function normalizeLoaderResult<TContext>(
  loader: ConfigLoader<TContext>,
  result: ConfigLoaderResult
):
  | {
      readonly ok: true;
      readonly value: unknown;
      readonly locations?: readonly ValueLocation[];
      readonly issues: readonly ConfigIssue[];
      readonly hasIssuesField: boolean;
    }
  | { readonly ok: false } {
  if (!isRecord(result)) {
    return { ok: false };
  }

  const rawIssues = result.issues;
  if (rawIssues !== undefined && !Array.isArray(rawIssues)) {
    return { ok: false };
  }
  const issues: ConfigIssue[] = [];
  for (const issue of rawIssues ?? []) {
    if (!isConfigIssue(issue)) {
      return { ok: false };
    }
    issues.push({
      category: issue.category,
      code: issue.code,
      severity: issue.severity,
      message: issue.message,
      ...(issue.path === undefined ? {} : { path: [...issue.path] }),
      sourceId: loader.descriptor.id,
      ...(issue.details === undefined ? {} : { details: { ...issue.details } })
    });
  }

  const rawLocations = result.locations;
  if (rawLocations !== undefined && !Array.isArray(rawLocations)) {
    return { ok: false };
  }
  const locations: ValueLocation[] = [];
  for (const valueLocation of rawLocations ?? []) {
    if (!isValueLocation(valueLocation)) {
      return { ok: false };
    }
    locations.push({
      path: [...valueLocation.path],
      location: {
        sourceId: loader.descriptor.id,
        ...(valueLocation.location.sourcePath === undefined
          ? {}
          : { sourcePath: valueLocation.location.sourcePath }),
        ...(valueLocation.location.line === undefined ? {} : { line: valueLocation.location.line }),
        ...(valueLocation.location.column === undefined ? {} : { column: valueLocation.location.column })
      }
    });
  }

  return {
    ok: true,
    value: result.value,
    ...(rawLocations === undefined ? {} : { locations }),
    issues,
    hasIssuesField: rawIssues !== undefined
  };
}

function isConfigIssue(value: unknown): value is ConfigIssue {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.category === "string" &&
    ISSUE_CATEGORIES.has(value.category) &&
    typeof value.code === "string" &&
    ISSUE_CODE_PATTERN.test(value.code) &&
    (value.severity === "error" || value.severity === "warning") &&
    typeof value.message === "string" &&
    (value.path === undefined || isConfigPath(value.path)) &&
    (value.sourceId === undefined || typeof value.sourceId === "string") &&
    (value.details === undefined || isIssueDetails(value.details))
  );
}

function isValueLocation(value: unknown): value is ValueLocation {
  if (!isRecord(value) || !isConfigPath(value.path) || !isRecord(value.location)) {
    return false;
  }
  const location = value.location;
  return (
    typeof location.sourceId === "string" &&
    (location.sourcePath === undefined || typeof location.sourcePath === "string") &&
    (location.line === undefined || isPositiveSafeInteger(location.line)) &&
    (location.column === undefined || isPositiveSafeInteger(location.column))
  );
}

function isConfigPath(value: unknown): value is ConfigPath {
  return (
    Array.isArray(value) &&
    value.every(
      (segment) => typeof segment === "string" || (typeof segment === "number" && Number.isSafeInteger(segment))
    )
  );
}

function isIssueDetails(value: unknown): value is Readonly<Record<string, string | number | boolean | null>> {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (detail) =>
        detail === null ||
        typeof detail === "string" ||
        typeof detail === "boolean" ||
        (typeof detail === "number" && Number.isFinite(detail))
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function boundIssues(input: readonly ConfigIssue[], maxDiagnostics: number): readonly ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  pushBoundedIssues(issues, input, maxDiagnostics);
  return issues;
}

function pushBoundedIssues(
  destination: ConfigIssue[],
  nextIssues: readonly ConfigIssue[],
  maxDiagnostics: number
): void {
  for (let index = 0; index < nextIssues.length; index += 1) {
    if (destination.length >= maxDiagnostics) {
      replaceLastIssueWithOverflowMarker(destination, maxDiagnostics);
      return;
    }
    destination.push(nextIssues[index]!);
    if (index < nextIssues.length - 1 && destination.length >= maxDiagnostics) {
      replaceLastIssueWithOverflowMarker(destination, maxDiagnostics);
      return;
    }
  }
}

function replaceLastIssueWithOverflowMarker(issues: ConfigIssue[], maxDiagnostics: number): void {
  if (issues.some(isDiagnosticsOverflowMarker)) {
    return;
  }
  issues[issues.length - 1] = {
    category: "resource-limit",
    code: "max_diagnostics_exceeded",
    severity: "error",
    message: `Diagnostics exceeded the maximum of ${maxDiagnostics}.`
  };
}

function isDiagnosticsOverflowMarker(issue: ConfigIssue): boolean {
  return issue.category === "resource-limit" && issue.code === "max_diagnostics_exceeded";
}

function loaderThrewIssue<TContext>(loader: ConfigLoader<TContext>): ConfigIssue {
  return {
    category: "source-load",
    code: "loader_threw",
    severity: "error",
    sourceId: loader.descriptor.id,
    message: `Loader ${loader.descriptor.id} threw an exception. Exception details were omitted from diagnostics.`
  };
}

function invalidLoaderResultIssue<TContext>(loader: ConfigLoader<TContext>): ConfigIssue {
  return {
    category: "source-load",
    code: "invalid_loader_result",
    severity: "error",
    sourceId: loader.descriptor.id,
    message: `Loader ${loader.descriptor.id} returned an invalid result.`
  };
}
