import type { ConfigPath } from "./types.js";

interface Node<T> {
  readonly children: Map<string | number, Node<T>>;
  readonly entries: T[];
  count: number;
}
const node = <T>(): Node<T> => ({ children: new Map(), entries: [], count: 0 });

/** Per-operation typed prefix index. Queries include both ancestors and descendants. */
export class PathIntersectionIndex<T> {
  private readonly root = node<T>();
  constructor(entries: readonly T[], pathOf: (entry: T) => ConfigPath) {
    for (const entry of entries) {
      let current = this.root;
      current.count++;
      for (const segment of pathOf(entry)) {
        let child = current.children.get(segment);
        if (child === undefined) { child = node<T>(); current.children.set(segment, child); }
        current = child;
        current.count++;
      }
      current.entries.push(entry);
    }
  }

  intersects(path: ConfigPath): boolean {
    let current = this.root;
    for (const segment of path) {
      if (current.entries.length > 0) return true;
      const child = current.children.get(segment);
      if (child === undefined) return false;
      current = child;
    }
    return current.count > 0;
  }

  related(path: ConfigPath): readonly T[] {
    const entries: T[] = [];
    let current = this.root;
    for (const segment of path) {
      for (const entry of current.entries) entries.push(entry);
      const child = current.children.get(segment);
      if (child === undefined) return entries;
      current = child;
    }
    const pending = [current];
    while (pending.length > 0) {
      const next = pending.pop()!;
      for (const entry of next.entries) entries.push(entry);
      for (const child of next.children.values()) pending.push(child);
    }
    return entries;
  }
}
