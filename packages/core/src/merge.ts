import { appendBoundedIssues } from "./diagnostics.js";
import { applyCoercionRules } from "./coercion.js";
import { getConfigValueAtPath, pathToKey, setConfigValueAtPath } from "./path.js";
import { flattenConfigObject } from "./value.js";
import { normalizeResourceLimits } from "./limits.js";
import { sourcePriorityIssues } from "./source-priority.js";
import { projectedMergeKeyCount } from "./merge-key-budget.js";
import {
  createResolvedPathIndex,
  deleteResolvedPath,
  findRelatedResolvedPaths,
  setResolvedPath,
  synchronizeCoercedResolvedPaths,
  type MutableResolvedPath,
  type MutableResolvedPathIndex
} from "./resolved-path-index.js";
import type {
  ConfigIssue,
  ConfigResult,
  ConfigSourceDescriptor,
  ConfigValue,
  LoadedSource,
  MergePolicy,
  ProvenanceEvent,
  ResolveConfigInput,
  ResourceLimitPolicy,
  SourceLocation,
  ValueLocation
} from "./types.js";

export const DEFAULT_MERGE_POLICY: MergePolicy = {
  objectPolicy: "deep-merge",
  arrayPolicy: "replace",
  scalarPolicy: "higher-priority-replaces",
  nullPolicy: "explicit-null-overwrites",
  unsafeKeyPolicy: "reject",
  samePriorityPolicy: "issue-and-later-source-wins"
};

export { DEFAULT_RESOURCE_LIMITS } from "./limits.js";

export function resolveConfig(input: ResolveConfigInput): ConfigResult {
  const limits = normalizeResourceLimits(input.limits);
  if (input.sources.length > limits.maxSources) {
    return {
      ok: false,
      config: {},
      sources: input.sources.slice(0, limits.maxSources).map((source) => source.descriptor),
      issues: [{
        category: "resource-limit",
        code: "max_sources_exceeded",
        severity: "error",
        message: `Source count exceeded the maximum of ${limits.maxSources}.`
      }],
      provenance: [],
      resolvedPaths: [],
      limits
    };
  }
  const priorityIssues = sourcePriorityIssues(input.sources, limits.maxDiagnostics);
  if (priorityIssues.length > 0) {
    return { ok: false, config: {}, sources: [], issues: priorityIssues, provenance: [], resolvedPaths: [], limits };
  }
  const policy: MergePolicy = { ...DEFAULT_MERGE_POLICY, ...input.mergePolicy };
  const sources = sortSources(input.sources);
  const descriptors = sources.map((source) => source.descriptor);
  let config: Record<string, ConfigValue> = {};
  const issues: ConfigIssue[] = [];
  const provenance: ProvenanceEvent[] = [];
  const resolvedIndex = createResolvedPathIndex();
  const sourceIdentityIssues = duplicateSourceIdIssues(sources, limits.maxDiagnostics);
  if (sourceIdentityIssues.length > 0) {
    return {
      ok: false,
      config,
      sources: descriptors,
      issues: sourceIdentityIssues,
      provenance,
      resolvedPaths: [],
      limits
    };
  }

  const keyBudget = { count: 0, exceeded: false };
  sourceLoop: for (const source of sources) {
    const sourceIssues = source.issues ?? [];
    const flattened = flattenSourceValue(source, limits);
    appendBoundedIssues(issues, sourceIssues, limits.maxDiagnostics);
    appendBoundedIssues(issues, flattened.issues, limits.maxDiagnostics);

    if (sourceIssues.some((issue) => issue.severity === "error") ||
        flattened.issues.some((issue) => issue.severity === "error")) {
      const event: ProvenanceEvent = {
        path: [],
        action: "rejected",
        sourceId: source.descriptor.id,
        message: `Source ${source.descriptor.id} was rejected before merge.`
      };
      if (provenance.length < limits.maxProvenanceEvents) {
        provenance.push(event);
      } else {
        pushResourceLimitIssueOnce(issues, "max_provenance_events_exceeded", limits.maxProvenanceEvents, limits);
      }
      continue;
    }

    const locationIndex = createLocationIndex(source.locations);
    // An old atomic parent can be displaced by the first flattened child. Keep
    // that ownership for the remaining siblings from this source, without
    // retaining obsolete paths in the live resolution index.
    const displacedParents = createResolvedPathIndex();
    for (const entry of flattened.entries) {
      const entryLocation = locationIndex.get(pathToKey(entry.path));
      applyEntry({
        config,
        descriptor: source.descriptor,
        entryPath: entry.path,
        entryValue: entry.value,
        ...(entryLocation === undefined ? {} : { entryLocation }),
        issues,
        limits,
        policy,
        provenance,
        resolvedIndex,
        displacedParents,
        keyBudget
      });
      if (keyBudget.exceeded) break sourceLoop;
    }
  }

  let didCoerce = false;
  if (input.coercionRules !== undefined && input.coercionRules.length > 0 && !issues.some(issue => issue.severity === "error")) {
    const coercionResult = applyCoercionRules({
      config,
      rules: input.coercionRules,
      limits,
      provenance
    });
    config = coercionResult.config as Record<string, ConfigValue>;
    didCoerce = coercionResult.provenance.length > 0;
    appendBoundedIssues(issues, coercionResult.issues, limits.maxDiagnostics);
    for (const event of coercionResult.provenance) {
      if (provenance.length < limits.maxProvenanceEvents) {
        provenance.push(event);
      } else {
        pushResourceLimitIssueOnce(issues, "max_provenance_events_exceeded", limits.maxProvenanceEvents, limits);
      }
    }
  }

  const finalStructure = flattenConfigObject("core:resolved-config", config, limits);
  appendBoundedIssues(issues, finalStructure.issues, limits.maxDiagnostics);
  if (didCoerce) {
    synchronizeCoercedResolvedPaths(resolvedIndex, finalStructure.entries);
  }
  const resolvedPaths = Array.from(resolvedIndex.byPath.values());
  if (resolvedPaths.length > limits.maxResolvedPaths) {
    pushResourceLimitIssueOnce(issues, "max_resolved_paths_exceeded", limits.maxResolvedPaths, limits);
  }

  return {
    ok: !issues.some((issue) => issue.severity === "error"),
    config,
    sources: descriptors,
    issues,
    provenance,
    resolvedPaths: resolvedPaths.slice(0, limits.maxResolvedPaths).map((resolved) => ({
      path: resolved.path,
      status: resolved.status,
      winningSourceId: resolved.winningSourceId,
      winningPriority: resolved.winningPriority,
      overriddenSourceIds: resolved.overriddenSourceIds,
      ...(resolved.winningLocation === undefined ? {} : { winningLocation: resolved.winningLocation }),
      ...(resolved.overriddenLocations.length === 0
        ? {}
        : { overriddenLocations: resolved.overriddenLocations })
    })),
    limits
  };
}

function duplicateSourceIdIssues(
  sources: readonly LoadedSource[],
  maxDiagnostics: number
): readonly ConfigIssue[] {
  const firstIndexById = new Map<string, number>();
  const issues: ConfigIssue[] = [];

  for (const [index, source] of sources.entries()) {
    const firstIndex = firstIndexById.get(source.descriptor.id);
    if (firstIndex === undefined) {
      firstIndexById.set(source.descriptor.id, index);
      continue;
    }
    appendBoundedIssues(
      issues,
      [
        {
          category: "source-load",
          code: "duplicate_source_id",
          severity: "error",
          sourceId: source.descriptor.id,
          message: `Source id duplicates the source declared at sorted index ${firstIndex}.`
        }
      ],
      maxDiagnostics
    );
  }

  return issues;
}

function flattenSourceValue(
  source: LoadedSource,
  limits: ResourceLimitPolicy
): ReturnType<typeof flattenConfigObject> {
  try {
    return flattenConfigObject(source.descriptor.id, source.value, limits);
  } catch {
    return {
      entries: [],
      issues: [
        {
          category: "parse",
          code: "source_value_inspection_failed",
          severity: "error",
          sourceId: source.descriptor.id,
          message: "Failed to inspect normalized source value. Exception details were omitted from diagnostics."
        }
      ]
    };
  }
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
  readonly entryLocation?: SourceLocation;
  readonly issues: ConfigIssue[];
  readonly limits: ResourceLimitPolicy;
  readonly policy: MergePolicy;
  readonly provenance: ProvenanceEvent[];
  readonly resolvedIndex: MutableResolvedPathIndex;
  readonly displacedParents: MutableResolvedPathIndex;
  readonly keyBudget: { count: number; exceeded: boolean };
}): void {
  if (input.entryPath.length === 0) {
    pushBoundedIssue(
      input.issues,
      {
        category: "merge",
        code: "empty_path",
        severity: "error",
        sourceId: input.descriptor.id,
        message: "Source entries must resolve to a non-root config path."
      },
      input.limits
    );
    return;
  }

  const pathKey = pathToKey(input.entryPath);
  const existingResolved = input.resolvedIndex.byPath.get(pathKey);
  const existingValue = getConfigValueAtPath(input.config, input.entryPath);
  // An empty object contributes no fields to an existing non-empty object.
  // Keep descendant ownership and locations; there was no overlapping write.
  if (isNonArrayObject(input.entryValue) && Object.keys(input.entryValue).length === 0 &&
      isNonArrayObject(existingValue) && Object.keys(existingValue).length > 0) return;
  const liveRelated = findRelatedResolvedPaths(input.resolvedIndex, input.entryPath);
  const relatedResolved = [...liveRelated, ...findRelatedResolvedPaths(input.displacedParents, input.entryPath)];

  if (
    relatedResolved.some(
      ({ resolved }) =>
        resolved.winningPriority === input.descriptor.priority &&
        resolved.winningSourceId !== input.descriptor.id
    )
  ) {
    pushBoundedIssue(
      input.issues,
      {
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
      },
      input.limits
    );
  }

  const nextKeyCount = projectedMergeKeyCount(input.config, input.entryPath, input.entryValue, input.keyBudget.count);
  if (nextKeyCount > input.limits.maxKeyCount) {
    input.keyBudget.exceeded = true;
    pushBoundedIssue(input.issues, { category: "resource-limit", code: "max_key_count_exceeded", severity: "error",
      sourceId: "core:resolved-config", message: `Combined config key/index count exceeds the maximum of ${input.limits.maxKeyCount}.`
    }, input.limits);
    return;
  }
  try {
    setConfigValueAtPath(input.config, input.entryPath, input.entryValue);
  } catch {
    pushBoundedIssue(
      input.issues,
      {
        category: "merge",
        code: "path_set_failed",
        severity: "error",
        path: input.entryPath,
        sourceId: input.descriptor.id,
        message: "Failed to set config path. Internal exception details were omitted from diagnostics."
      },
      input.limits
    );
    return;
  }
  input.keyBudget.count = nextKeyCount;

  if (relatedResolved.length === 0 && existingValue === undefined) {
    const event: ProvenanceEvent = {
      path: input.entryPath,
      action: "defined",
      sourceId: input.descriptor.id,
      message: `Path was defined by source ${input.descriptor.id}.`
    };
    if (input.provenance.length < input.limits.maxProvenanceEvents) {
      input.provenance.push(event);
    } else {
      pushResourceLimitIssueOnce(
        input.issues,
        "max_provenance_events_exceeded",
        input.limits.maxProvenanceEvents,
        input.limits
      );
    }
    setResolvedPath(input.resolvedIndex, {
      path: input.entryPath,
      status: "resolved",
      winningSourceId: input.descriptor.id,
      winningPriority: input.descriptor.priority,
      overriddenSourceIds: [],
      ...(input.entryLocation === undefined ? {} : { winningLocation: input.entryLocation }),
      overriddenLocations: []
    });
    return;
  }

  const overriddenSourceIds = collectOverriddenSourceIds(relatedResolved, input.descriptor.id);
  const overriddenLocations = collectOverriddenLocations(relatedResolved);
  for (const { key, resolved } of liveRelated) {
    if (resolved.path.length < input.entryPath.length) setResolvedPath(input.displacedParents, resolved);
    deleteResolvedPath(input.resolvedIndex, key);
  }
  // History is oldest-first; the previous winner must come from current owners.
  // A parent replacement can overlap several owners: select the highest priority,
  // retaining traversal order for ties rather than inventing a historical owner.
  const previousWinner = existingResolved ?? relatedResolved.reduce<MutableResolvedPath | undefined>(
    (winner, { resolved }) => winner === undefined || resolved.winningPriority > winner.winningPriority ? resolved : winner,
    undefined
  );
  const previousSourceId = previousWinner?.winningSourceId === input.descriptor.id
    ? undefined : previousWinner?.winningSourceId;
  const event: ProvenanceEvent = {
    path: input.entryPath,
    action: "overridden",
    sourceId: input.descriptor.id,
    ...(previousSourceId === undefined ? {} : { previousSourceId }),
    message:
      previousSourceId === undefined
        ? `Source ${input.descriptor.id} replaced an overlapping config shape.`
        : `Source ${input.descriptor.id} overrode source ${previousSourceId}.`
  };
  if (input.provenance.length < input.limits.maxProvenanceEvents) {
    input.provenance.push(event);
  } else {
    pushResourceLimitIssueOnce(
      input.issues,
      "max_provenance_events_exceeded",
      input.limits.maxProvenanceEvents,
      input.limits
    );
  }
  setResolvedPath(input.resolvedIndex, {
    path: input.entryPath,
    status: "resolved",
    winningSourceId: input.descriptor.id,
    winningPriority: input.descriptor.priority,
    overriddenSourceIds,
    ...(input.entryLocation === undefined ? {} : { winningLocation: input.entryLocation }),
    overriddenLocations
  });
}

function isNonArrayObject(value: ConfigValue | undefined): value is { readonly [key: string]: ConfigValue } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function createLocationIndex(
  locations: readonly ValueLocation[] | undefined
): ReadonlyMap<string, SourceLocation> {
  const index = new Map<string, SourceLocation>();
  for (const valueLocation of locations ?? []) {
    index.set(pathToKey(valueLocation.path), valueLocation.location);
  }
  return index;
}

function pushResourceLimitIssueOnce(
  issues: ConfigIssue[],
  code: string,
  maximum: number,
  limits: ResourceLimitPolicy
): void {
  if (issues.some((issue) => issue.category === "resource-limit" && issue.code === code)) return;
  pushBoundedIssue(issues, {
    category: "resource-limit",
    code,
    severity: "error",
    message: `Retained entries exceeded the maximum of ${maximum}.`
  }, limits);
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

function collectOverriddenLocations(
  relatedResolved: readonly { readonly resolved: MutableResolvedPath }[]
): SourceLocation[] {
  const locations: SourceLocation[] = [];
  for (const { resolved } of relatedResolved) {
    locations.push(...resolved.overriddenLocations);
    if (resolved.winningLocation !== undefined) locations.push(resolved.winningLocation);
  }
  return locations;
}

function pushBoundedIssue(
  destination: ConfigIssue[],
  issue: ConfigIssue,
  limits: ResourceLimitPolicy
): void {
  appendBoundedIssues(destination, [issue], limits.maxDiagnostics);
}
