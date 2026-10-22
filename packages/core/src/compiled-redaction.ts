import type { ConfigPath, ConfigSourceDescriptor } from "./types.js";
import type { BuildDiagnosticReportOptions, RedactionDecision } from "./redaction.js";

interface RankedNode { readonly children: Map<string | number, RankedNode>; rank: number; }
const node = (): RankedNode => ({ children: new Map(), rank: Infinity });
class RankedPaths {
  private readonly root = node();
  add(path: ConfigPath, rank: number): void {
    let current = this.root;
    for (const segment of path) {
      let child = current.children.get(segment);
      if (child === undefined) { child = node(); current.children.set(segment, child); }
      current = child;
    }
    current.rank = Math.min(current.rank, rank);
  }
  match(path: ConfigPath): number {
    let current = this.root;
    let rank = current.rank;
    for (const segment of path) {
      const child = current.children.get(segment);
      if (child === undefined) break;
      current = child;
      rank = Math.min(rank, current.rank);
    }
    return rank;
  }
}

/** Compile once while retaining first-source and within-source path-before-name precedence. */
export function compileRedaction(
  sources: Iterable<ConfigSourceDescriptor>, options: BuildDiagnosticReportOptions,
  defaults: readonly string[], secretSourcePaths: Iterable<ConfigPath>
): (path: ConfigPath) => RedactionDecision {
  const paths = new RankedPaths();
  const owned = new RankedPaths();
  const patterns = new Map<string, number>();
  const addPatterns = (values: readonly string[] | undefined, rank: number) => {
    for (const value of values ?? []) {
      const key = value.toLowerCase();
      patterns.set(key, Math.min(patterns.get(key) ?? Infinity, rank));
    }
  };
  for (const path of secretSourcePaths) owned.add(path, 0);
  for (const path of options.secretPaths ?? []) paths.add(path, 0);
  addPatterns(options.secretNamePatterns, 0);
  addPatterns(defaults, 0);
  let rank = 0;
  for (const source of sources) {
    for (const path of source.redaction?.secretPaths ?? []) paths.add(path, rank);
    addPatterns(source.redaction?.secretNamePatterns, rank);
    rank++;
  }
  return path => {
    if (owned.match(path) !== Infinity) return { redacted: true, reason: "secret-source" };
    const pathRank = paths.match(path);
    let nameRank = Infinity;
    const name = path.map(String).join(".").toLowerCase();
    const last = String(path[path.length - 1] ?? "").toLowerCase();
    for (const [pattern, rank] of patterns) {
      if (rank < nameRank && (name.includes(pattern) || last.includes(pattern))) nameRank = rank;
    }
    if (pathRank !== Infinity && pathRank <= nameRank) return { redacted: true, reason: "secret-path" };
    return nameRank !== Infinity ? { redacted: true, reason: "secret-name" } : { redacted: false };
  };
}
