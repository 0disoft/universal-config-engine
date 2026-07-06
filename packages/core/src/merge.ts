import { getConfigValueAtPath, pathToKey, setConfigValueAtPath } from "./path.js";
import { flattenConfigObject } from "./value.js";
import type {
  ConfigIssue,
  ConfigResult,
  ConfigSourceDescriptor,
  ConfigValue,
  LoadedSource,
  MergePolicy,
  ProvenanceEvent,
  ResolveConfigInput,
  ResolvedPath,
  ResourceLimitPolicy
} from "./types.js";

export const DEFAULT_MERGE_POLICY: MergePolicy = {
  objectPolicy: "deep-merge",
  arrayPolicy: "replace",
  scalarPolicy: "higher-priority-replaces",
  nullPolicy: "explicit-null-overwrites",
  unsafeKeyPolicy: "reject",
  samePriorityPolicy: "issue-and-later-source-wins"
};

export const DEFAULT_RESOURCE_LIMITS: ResourceLimitPolicy = {
  maxDepth: 32,
  maxKeyCount: 10_000,
  maxPathLength: 32,
  maxDiagnostics: 200
};

interface MutableResolvedPath {
  path: readonly (string | number)[];
  status: "resolved";
  winningSourceId: string;
  winningPriority: number;
  overriddenSourceIds: string[];
}

export function resolveConfig(input: ResolveConfigInput): ConfigResult {
  const policy: MergePolicy = { ...DEFAULT_MERGE_POLICY, ...input.mergePolicy };
  const limits: ResourceLimitPolicy = { ...DEFAULT_RESOURCE_LIMITS, ...input.limits };
  const sources = sortSources(input.sources);
  const descriptors = sources.map((source) => source.descriptor);
  const config: Record<string, ConfigValue> = {};
  const issues: ConfigIssue[] = [];
  const provenance: ProvenanceEvent[] = [];
  const resolvedByPath = new Map<string, MutableResolvedPath>();

  for (const source of sources) {
    const sourceIssues = [...(source.issues ?? [])];
    const flattened = flattenConfigObject(source.descriptor.id, source.value, limits);
    sourceIssues.push(...flattened.issues);
    pushBoundedIssues(issues, sourceIssues, limits);

    if (sourceIssues.some((issue) => issue.severity === "error")) {
      provenance.push({
        path: [],
        action: "rejected",
        sourceId: source.descriptor.id,
        message: `Source ${source.descriptor.id} was rejected before merge.`
      });
      continue;
    }

    for (const entry of flattened.entries) {
      applyEntry({
        config,
        descriptor: source.descriptor,
        entryPath: entry.path,
        entryValue: entry.value,
        issues,
        limits,
        policy,
        provenance,
        resolvedByPath
      });
    }
  }

  const limitedIssues = limitDiagnostics(issues, limits);

  return {
    ok: !limitedIssues.some((issue) => issue.severity === "error"),
    config,
    sources: descriptors,
    issues: limitedIssues,
    provenance,
    resolvedPaths: Array.from(resolvedByPath.values()).map((resolved) => ({
      path: resolved.path,
      status: resolved.status,
      winningSourceId: resolved.winningSourceId,
      winningPriority: resolved.winningPriority,
      overriddenSourceIds: resolved.overriddenSourceIds
    })),
    limits
  };
}

function sortSources(sources: readonly LoadedSource[]): readonly LoadedSource[] {
  return sources
    .map((source, index) => ({ source, index }))
    .sort((left, right) => {
      const priorityDelta = left.source.descriptor.priority - right.source.descriptor.priority;
      return priorityDelta === 0 ? left.index - right.index : priorityDelta;
    })
    .map(({ source }) => source);
}

function applyEntry(input: {
  readonly config: Record<string, ConfigValue>;
  readonly descriptor: ConfigSourceDescriptor;
  readonly entryPath: readonly (string | number)[];
  readonly entryValue: ConfigValue;
  readonly issues: ConfigIssue[];
  readonly limits: ResourceLimitPolicy;
  readonly policy: MergePolicy;
  readonly provenance: ProvenanceEvent[];
  readonly resolvedByPath: Map<string, MutableResolvedPath>;
}): void {
  if (input.entryPath.length === 0) {
    input.issues.push({
      category: "merge",
      code: "empty_path",
      severity: "error",
      sourceId: input.descriptor.id,
      message: "Source entries must resolve to a non-root config path."
    });
    return;
  }

  const pathKey = pathToKey(input.entryPath);
  const existingResolved = input.resolvedByPath.get(pathKey);
  const existingValue = getConfigValueAtPath(input.config, input.entryPath);

  if (
    existingResolved !== undefined &&
    existingResolved.winningPriority === input.descriptor.priority &&
    existingResolved.winningSourceId !== input.descriptor.id
  ) {
    input.issues.push({
      category: "merge",
      code: "same_priority_conflict",
      severity: "error",
      path: input.entryPath,
      sourceId: input.descriptor.id,
      message: "Two sources with the same priority wrote the same config path.",
      details: {
        previousSourceId: existingResolved.winningSourceId,
        priority: input.descriptor.priority
      }
    });
  }

  try {
    setConfigValueAtPath(input.config, input.entryPath, input.entryValue);
  } catch (error) {
    input.issues.push({
      category: "merge",
      code: "path_set_failed",
      severity: "error",
      path: input.entryPath,
      sourceId: input.descriptor.id,
      message: error instanceof Error ? error.message : "Failed to set config path."
    });
    return;
  }

  if (existingValue === undefined || existingResolved === undefined) {
    input.provenance.push({
      path: input.entryPath,
      action: "defined",
      sourceId: input.descriptor.id,
      message: `Path was defined by source ${input.descriptor.id}.`
    });
    input.resolvedByPath.set(pathKey, {
      path: input.entryPath,
      status: "resolved",
      winningSourceId: input.descriptor.id,
      winningPriority: input.descriptor.priority,
      overriddenSourceIds: []
    });
    return;
  }

  const overriddenSourceIds = [...existingResolved.overriddenSourceIds, existingResolved.winningSourceId];
  input.provenance.push({
    path: input.entryPath,
    action: "overridden",
    sourceId: input.descriptor.id,
    previousSourceId: existingResolved.winningSourceId,
    message: `Source ${input.descriptor.id} overrode source ${existingResolved.winningSourceId}.`
  });
  input.resolvedByPath.set(pathKey, {
    path: input.entryPath,
    status: "resolved",
    winningSourceId: input.descriptor.id,
    winningPriority: input.descriptor.priority,
    overriddenSourceIds
  });
}

function pushBoundedIssues(
  destination: ConfigIssue[],
  nextIssues: readonly ConfigIssue[],
  limits: ResourceLimitPolicy
): void {
  for (const issue of nextIssues) {
    if (destination.length >= limits.maxDiagnostics) {
      return;
    }
    destination.push(issue);
  }
}

function limitDiagnostics(issues: readonly ConfigIssue[], limits: ResourceLimitPolicy): readonly ConfigIssue[] {
  if (issues.length <= limits.maxDiagnostics) {
    return issues;
  }

  return [
    ...issues.slice(0, limits.maxDiagnostics),
    {
      category: "resource-limit",
      code: "max_diagnostics_exceeded",
      severity: "error",
      message: `Diagnostics exceeded the maximum of ${limits.maxDiagnostics}.`
    }
  ];
}
