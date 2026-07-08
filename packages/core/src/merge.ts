import { applyCoercionRules } from "./coercion.js";
import { getConfigValueAtPath, isPathPrefix, pathToKey, pathsEqual, setConfigValueAtPath } from "./path.js";
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

  if (input.coercionRules !== undefined && input.coercionRules.length > 0) {
    const coercionResult = applyCoercionRules({
      config,
      rules: input.coercionRules
    });
    pushBoundedIssues(issues, coercionResult.issues, limits);
    provenance.push(...coercionResult.provenance);
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
  const relatedResolved = findRelatedResolvedPaths(input.resolvedByPath, input.entryPath);

  if (
    relatedResolved.some(
      ({ resolved }) =>
        resolved.winningPriority === input.descriptor.priority &&
        resolved.winningSourceId !== input.descriptor.id
    )
  ) {
    input.issues.push({
      category: "merge",
      code: "same_priority_conflict",
      severity: "error",
      path: input.entryPath,
      sourceId: input.descriptor.id,
      message: "Two sources with the same priority wrote the same or overlapping config path.",
      details: {
        previousSourceId: relatedResolved[0]?.resolved.winningSourceId ?? existingResolved?.winningSourceId ?? "",
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

  if (relatedResolved.length === 0 && existingValue === undefined) {
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

  const overriddenSourceIds = collectOverriddenSourceIds(relatedResolved, input.descriptor.id);
  for (const { key } of relatedResolved) {
    input.resolvedByPath.delete(key);
  }
  const previousSourceId = overriddenSourceIds[0];
  input.provenance.push({
    path: input.entryPath,
    action: "overridden",
    sourceId: input.descriptor.id,
    ...(previousSourceId === undefined ? {} : { previousSourceId }),
    message:
      previousSourceId === undefined
        ? `Source ${input.descriptor.id} replaced an overlapping config shape.`
        : `Source ${input.descriptor.id} overrode source ${previousSourceId}.`
  });
  input.resolvedByPath.set(pathKey, {
    path: input.entryPath,
    status: "resolved",
    winningSourceId: input.descriptor.id,
    winningPriority: input.descriptor.priority,
    overriddenSourceIds
  });
}

function findRelatedResolvedPaths(
  resolvedByPath: ReadonlyMap<string, MutableResolvedPath>,
  path: readonly (string | number)[]
): readonly { readonly key: string; readonly resolved: MutableResolvedPath }[] {
  return Array.from(resolvedByPath.entries())
    .filter(([, resolved]) => pathsOverlap(resolved.path, path))
    .map(([key, resolved]) => ({ key, resolved }));
}

function pathsOverlap(left: readonly (string | number)[], right: readonly (string | number)[]): boolean {
  return pathsEqual(left, right) || isPathPrefix(left, right) || isPathPrefix(right, left);
}

function collectOverriddenSourceIds(
  relatedResolved: readonly { readonly resolved: MutableResolvedPath }[],
  currentSourceId: string
): string[] {
  const sourceIds = new Set<string>();

  for (const { resolved } of relatedResolved) {
    for (const sourceId of [...resolved.overriddenSourceIds, resolved.winningSourceId]) {
      if (sourceId !== currentSourceId) {
        sourceIds.add(sourceId);
      }
    }
  }

  return [...sourceIds];
}

function pushBoundedIssues(
  destination: ConfigIssue[],
  nextIssues: readonly ConfigIssue[],
  limits: ResourceLimitPolicy
): void {
  const maxDiagnostics = Math.max(1, limits.maxDiagnostics);
  for (const [index, issue] of nextIssues.entries()) {
    if (destination.length >= maxDiagnostics) {
      replaceLastIssueWithDiagnosticsExceededMarker(destination, limits);
      return;
    }
    destination.push(issue);
    if (index < nextIssues.length - 1 && destination.length >= maxDiagnostics) {
      replaceLastIssueWithDiagnosticsExceededMarker(destination, limits);
      return;
    }
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

function replaceLastIssueWithDiagnosticsExceededMarker(issues: ConfigIssue[], limits: ResourceLimitPolicy): void {
  if (issues.some((issue) => issue.category === "resource-limit" && issue.code === "max_diagnostics_exceeded")) {
    return;
  }

  const marker: ConfigIssue = {
    category: "resource-limit",
    code: "max_diagnostics_exceeded",
    severity: "error",
    message: `Diagnostics exceeded the maximum of ${limits.maxDiagnostics}.`
  };

  if (issues.length === 0) {
    issues.push(marker);
    return;
  }

  issues[issues.length - 1] = marker;
}
