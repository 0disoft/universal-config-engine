import { applyCoercionRules } from "./coercion.js";
import { getConfigValueAtPath, pathToKey, setConfigValueAtPath } from "./path.js";
import { flattenConfigObject } from "./value.js";
import { DEFAULT_RESOURCE_LIMITS, normalizeResourceLimits } from "./limits.js";
import type {
  ConfigIssue,
  ConfigResult,
  ConfigPath,
  ConfigPathSegment,
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

export { DEFAULT_RESOURCE_LIMITS } from "./limits.js";

interface MutableResolvedPath {
  path: ConfigPath;
  status: "resolved";
  winningSourceId: string;
  winningPriority: number;
  overriddenSourceIds: string[];
}

interface MutableResolvedPathIndex {
  readonly byPath: Map<string, MutableResolvedPath>;
  readonly root: ResolvedPathTrieNode;
}

interface ResolvedPathTrieNode {
  readonly children: Map<string, ResolvedPathTrieNode>;
  entryKey?: string;
}

export function resolveConfig(input: ResolveConfigInput): ConfigResult {
  const policy: MergePolicy = { ...DEFAULT_MERGE_POLICY, ...input.mergePolicy };
  const limits = normalizeResourceLimits(input.limits);
  const sources = sortSources(input.sources);
  const descriptors = sources.map((source) => source.descriptor);
  const config: Record<string, ConfigValue> = {};
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

  for (const source of sources) {
    const sourceIssues = [...(source.issues ?? [])];
    const flattened = flattenSourceValue(source, limits);
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
        resolvedIndex
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

  const finalStructure = flattenConfigObject("core:resolved-config", config, limits);
  pushBoundedIssues(issues, finalStructure.issues, limits);

  return {
    ok: !issues.some((issue) => issue.severity === "error"),
    config,
    sources: descriptors,
    issues,
    provenance,
    resolvedPaths: Array.from(resolvedIndex.byPath.values()).map((resolved) => ({
      path: resolved.path,
      status: resolved.status,
      winningSourceId: resolved.winningSourceId,
      winningPriority: resolved.winningPriority,
      overriddenSourceIds: resolved.overriddenSourceIds
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
    pushBoundedIssues(
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
      { ...DEFAULT_RESOURCE_LIMITS, maxDiagnostics }
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
  readonly issues: ConfigIssue[];
  readonly limits: ResourceLimitPolicy;
  readonly policy: MergePolicy;
  readonly provenance: ProvenanceEvent[];
  readonly resolvedIndex: MutableResolvedPathIndex;
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
  const relatedResolved = findRelatedResolvedPaths(input.resolvedIndex, input.entryPath);

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

  if (relatedResolved.length === 0 && existingValue === undefined) {
    input.provenance.push({
      path: input.entryPath,
      action: "defined",
      sourceId: input.descriptor.id,
      message: `Path was defined by source ${input.descriptor.id}.`
    });
    setResolvedPath(input.resolvedIndex, {
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
    deleteResolvedPath(input.resolvedIndex, key);
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
  setResolvedPath(input.resolvedIndex, {
    path: input.entryPath,
    status: "resolved",
    winningSourceId: input.descriptor.id,
    winningPriority: input.descriptor.priority,
    overriddenSourceIds
  });
}

function findRelatedResolvedPaths(
  resolvedIndex: MutableResolvedPathIndex,
  path: ConfigPath
): readonly { readonly key: string; readonly resolved: MutableResolvedPath }[] {
  const relatedKeys = new Set<string>();
  collectAncestorResolvedPathKeys(resolvedIndex.root, path, relatedKeys);

  const exactKey = pathToKey(path);
  if (resolvedIndex.byPath.has(exactKey)) {
    relatedKeys.add(exactKey);
  }

  const descendantRoot = findTrieNode(resolvedIndex.root, path);
  if (descendantRoot !== undefined) {
    collectDescendantResolvedPathKeys(descendantRoot, relatedKeys);
  }

  return [...relatedKeys].flatMap((key) => {
    const resolved = resolvedIndex.byPath.get(key);
    return resolved === undefined ? [] : [{ key, resolved }];
  });
}

function createResolvedPathIndex(): MutableResolvedPathIndex {
  return {
    byPath: new Map(),
    root: createTrieNode()
  };
}

function createTrieNode(): ResolvedPathTrieNode {
  return {
    children: new Map()
  };
}

function setResolvedPath(index: MutableResolvedPathIndex, resolved: MutableResolvedPath): void {
  const key = pathToKey(resolved.path);
  index.byPath.set(key, resolved);

  let node = index.root;
  for (const segment of resolved.path) {
    const segmentKey = trieSegmentKey(segment);
    const existing = node.children.get(segmentKey);
    if (existing !== undefined) {
      node = existing;
      continue;
    }

    const child = createTrieNode();
    node.children.set(segmentKey, child);
    node = child;
  }
  node.entryKey = key;
}

function deleteResolvedPath(index: MutableResolvedPathIndex, key: string): void {
  const resolved = index.byPath.get(key);
  if (resolved === undefined) {
    return;
  }

  index.byPath.delete(key);
  deleteTriePath(index.root, resolved.path, 0);
}

function deleteTriePath(node: ResolvedPathTrieNode, path: ConfigPath, depth: number): boolean {
  if (depth === path.length) {
    delete node.entryKey;
    return node.children.size === 0;
  }

  const segment = path[depth];
  if (segment === undefined) {
    return node.children.size === 0 && node.entryKey === undefined;
  }

  const segmentKey = trieSegmentKey(segment);
  const child = node.children.get(segmentKey);
  if (child === undefined) {
    return node.children.size === 0 && node.entryKey === undefined;
  }

  if (deleteTriePath(child, path, depth + 1)) {
    node.children.delete(segmentKey);
  }

  return node.children.size === 0 && node.entryKey === undefined;
}

function collectAncestorResolvedPathKeys(
  root: ResolvedPathTrieNode,
  path: ConfigPath,
  relatedKeys: Set<string>
): void {
  let node = root;

  for (const segment of path) {
    const entryKey = node.entryKey;
    if (entryKey !== undefined) {
      relatedKeys.add(entryKey);
    }

    const child = node.children.get(trieSegmentKey(segment));
    if (child === undefined) {
      return;
    }
    node = child;
  }

  const entryKey = node.entryKey;
  if (entryKey !== undefined) {
    relatedKeys.add(entryKey);
  }
}

function findTrieNode(root: ResolvedPathTrieNode, path: ConfigPath): ResolvedPathTrieNode | undefined {
  let node = root;

  for (const segment of path) {
    const child = node.children.get(trieSegmentKey(segment));
    if (child === undefined) {
      return undefined;
    }
    node = child;
  }

  return node;
}

function collectDescendantResolvedPathKeys(node: ResolvedPathTrieNode, relatedKeys: Set<string>): void {
  const entryKey = node.entryKey;
  if (entryKey !== undefined) {
    relatedKeys.add(entryKey);
  }

  for (const child of node.children.values()) {
    collectDescendantResolvedPathKeys(child, relatedKeys);
  }
}

function trieSegmentKey(segment: ConfigPathSegment): string {
  return JSON.stringify(segment);
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

function pushBoundedIssue(
  destination: ConfigIssue[],
  issue: ConfigIssue,
  limits: ResourceLimitPolicy
): void {
  pushBoundedIssues(destination, [issue], limits);
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
