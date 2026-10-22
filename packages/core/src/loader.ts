import { appendBoundedIssues, markDiagnosticsOverflow } from "./diagnostics.js";
import { isConfigPath, isIssueCode, isIssueDetails, isRecord } from "./adapter-guards.js";
import type {
  ConfigIssue,
  ConfigLoader,
  ConfigLoaderResult,
  LoadedSource,
  ResourceLimitPolicy,
  ValueLocation
} from "./types.js";
import { normalizeResourceLimits } from "./limits.js";
import { duplicateSourceIdIssues } from "./source-identity.js";
import { sourcePriorityIssues } from "./source-priority.js";
import { normalizeLoaderLocations } from "./loader-locations.js";

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
  const limits = normalizeResourceLimits(input.limits);
  const maxDiagnostics = limits.maxDiagnostics;

  if (input.loaders.length > limits.maxSources) {
    return {
      sources,
      issues: [{
        category: "resource-limit",
        code: "max_sources_exceeded",
        severity: "error",
        message: `Source count exceeded the maximum of ${limits.maxSources}.`
      }]
    };
  }

  const priorityIssues = sourcePriorityIssues(input.loaders, maxDiagnostics);
  if (priorityIssues.length > 0) return { sources, issues: priorityIssues };
  const identityIssues = duplicateSourceIdIssues(input.loaders, maxDiagnostics);
  if (identityIssues.length > 0) return { sources, issues: identityIssues };

  for (const loader of input.loaders) {
    try {
      const result = await loader.load(input.context);
      const source = toLoadedSource(loader, result, limits);
      sources.push(source);
      appendBoundedIssues(issues, source.issues ?? [], maxDiagnostics);
    } catch {
      const issue = loaderThrewIssue(loader);
      const source: LoadedSource = {
        descriptor: loader.descriptor,
        value: {},
        issues: [issue]
      };
      sources.push(source);
      appendBoundedIssues(issues, [issue], maxDiagnostics);
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
  limits: ResourceLimitPolicy
): LoadedSource {
  const normalized = normalizeLoaderResult(loader, result, limits);
  if (!normalized.ok) {
    return {
      descriptor: loader.descriptor,
      value: {},
      issues: [invalidLoaderResultIssue(loader)]
    };
  }
  return {
    descriptor: loader.descriptor,
    value: normalized.value,
    ...(normalized.locations === undefined ? {} : { locations: normalized.locations }),
    ...(normalized.hasIssuesField ? { issues: normalized.issues } : {})
  };
}

function normalizeLoaderResult<TContext>(
  loader: ConfigLoader<TContext>,
  result: ConfigLoaderResult,
  limits: ResourceLimitPolicy
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
  const { maxDiagnostics } = limits;

  const rawIssues = result.issues;
  if (rawIssues !== undefined && !Array.isArray(rawIssues)) {
    return { ok: false };
  }
  const issues: ConfigIssue[] = [];
  let overflowed = false;
  for (const issue of rawIssues ?? []) {
    if (!isConfigIssue(issue, limits)) {
      return { ok: false };
    }
    if (issues.length >= maxDiagnostics) {
      if (!overflowed) markDiagnosticsOverflow(issues, maxDiagnostics);
      overflowed = true;
      continue;
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
  const positions = normalizeLoaderLocations(rawLocations ?? [], loader.descriptor.id, limits);
  if (!positions.ok) return { ok: false };
  if (positions.omitted) appendBoundedIssues(issues, [{
    category: "resource-limit", code: "max_location_metadata_exceeded", severity: "warning",
    sourceId: loader.descriptor.id,
    message: "Source locations exceeded their path, count or byte budget; optional locations were omitted."
  }], maxDiagnostics);

  return {
    ok: true,
    value: result.value,
    ...(rawLocations === undefined ? {} : { locations: positions.locations }),
    issues,
    hasIssuesField: rawIssues !== undefined || positions.omitted
  };
}

function isConfigIssue(value: unknown, limits: ResourceLimitPolicy): value is ConfigIssue {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.category === "string" &&
    ISSUE_CATEGORIES.has(value.category) &&
    isIssueCode(value.code) &&
    (value.severity === "error" || value.severity === "warning") &&
    typeof value.message === "string" &&
    (value.path === undefined || isConfigPath(value.path, limits)) &&
    (value.sourceId === undefined || typeof value.sourceId === "string") &&
    (value.details === undefined || isIssueDetails(value.details))
  );
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
