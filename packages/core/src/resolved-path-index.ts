import { pathToKey } from "./path.js";
import type { ConfigPath, ConfigPathSegment, SourceLocation } from "./types.js";
import type { FlattenedConfigEntry } from "./value.js";

export interface MutableResolvedPath {
  path: ConfigPath;
  status: "resolved";
  winningSourceId: string;
  winningPriority: number;
  overriddenSourceIds: string[];
  winningLocation?: SourceLocation;
  overriddenLocations: SourceLocation[];
}

export interface MutableResolvedPathIndex {
  readonly byPath: Map<string, MutableResolvedPath>;
  readonly root: ResolvedPathTrieNode;
}

interface ResolvedPathTrieNode {
  readonly children: Map<string, ResolvedPathTrieNode>;
  entryKey?: string;
}

export function synchronizeCoercedResolvedPaths(
  index: MutableResolvedPathIndex,
  entries: readonly FlattenedConfigEntry[]
): void {
  const projectedByOwner = new Map<string, ConfigPath[]>();
  for (const entry of entries) {
    let node = index.root;
    let ownerKey = node.entryKey;
    for (const segment of entry.path) {
      const child = node.children.get(trieSegmentKey(segment));
      if (child === undefined) break;
      node = child;
      if (node.entryKey !== undefined) ownerKey = node.entryKey;
    }
    if (ownerKey === undefined) continue;
    const paths = projectedByOwner.get(ownerKey) ?? [];
    paths.push(entry.path);
    projectedByOwner.set(ownerKey, paths);
  }

  // Coercion changes value shape, not source ownership. Rebuild in original
  // owner order, retaining the source history and location of the encoded value.
  const owners = [...index.byPath.entries()];
  index.byPath.clear();
  index.root.children.clear();
  delete index.root.entryKey;
  for (const [key, owner] of owners) {
    for (const path of projectedByOwner.get(key) ?? []) {
      setResolvedPath(index, { ...owner, path });
    }
  }
}

export function findRelatedResolvedPaths(
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

export function createResolvedPathIndex(): MutableResolvedPathIndex {
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

export function setResolvedPath(index: MutableResolvedPathIndex, resolved: MutableResolvedPath): void {
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

export function deleteResolvedPath(index: MutableResolvedPathIndex, key: string): void {
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
