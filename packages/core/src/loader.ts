import type {
  ConfigIssue,
  ConfigLoader,
  ConfigLoaderResult,
  LoadedSource
} from "./types.js";

export interface LoadConfigSourcesInput<TContext = undefined> {
  readonly loaders: readonly ConfigLoader<TContext>[];
  readonly context: TContext;
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

  for (const loader of input.loaders) {
    try {
      const result = await loader.load(input.context);
      const source = toLoadedSource(loader, result);
      sources.push(source);
      issues.push(...(source.issues ?? []));
    } catch (error) {
      const issue = loaderThrewIssue(loader, error);
      const source: LoadedSource = {
        descriptor: loader.descriptor,
        value: {},
        issues: [issue]
      };
      sources.push(source);
      issues.push(issue);
    }
  }

  return {
    sources,
    issues
  };
}

function toLoadedSource<TContext>(
  loader: ConfigLoader<TContext>,
  result: ConfigLoaderResult
): LoadedSource {
  return {
    descriptor: loader.descriptor,
    value: result.value,
    ...(result.locations === undefined ? {} : { locations: result.locations }),
    ...(result.issues === undefined ? {} : { issues: result.issues })
  };
}

function loaderThrewIssue<TContext>(loader: ConfigLoader<TContext>, error: unknown): ConfigIssue {
  return {
    category: "source-load",
    code: "loader_threw",
    severity: "error",
    sourceId: loader.descriptor.id,
    message: error instanceof Error ? error.message : `Loader ${loader.descriptor.id} failed.`
  };
}
