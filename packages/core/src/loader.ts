import type {
  ConfigIssue,
  ConfigLoader,
  ConfigLoaderResult,
  LoadedSource,
  ResourceLimitPolicy
} from "./types.js";
import { DEFAULT_RESOURCE_LIMITS } from "./merge.js";

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
  const maxDiagnostics = Math.max(
    1,
    input.limits?.maxDiagnostics ?? DEFAULT_RESOURCE_LIMITS.maxDiagnostics
  );

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
  const issues = boundIssues(result.issues ?? [], maxDiagnostics);
  return {
    descriptor: loader.descriptor,
    value: result.value,
    ...(result.locations === undefined ? {} : { locations: result.locations }),
    ...(result.issues === undefined ? {} : { issues })
  };
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
