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
  const matchName = compileNameMatcher(patterns);
  return path => {
    if (owned.match(path) !== Infinity) return { redacted: true, reason: "secret-source" };
    const pathRank = paths.match(path);
    if (pathRank === 0) return { redacted: true, reason: "secret-path" };
    const name = path.map(String).join(".").toLowerCase();
    const last = String(path[path.length - 1] ?? "").toLowerCase();
    const nameRank = matchName(name, last);
    if (pathRank !== Infinity && pathRank <= nameRank) return { redacted: true, reason: "secret-path" };
    return nameRank !== Infinity ? { redacted: true, reason: "secret-name" } : { redacted: false };
  };
}

// Native substring checks are cheaper for small policies. Large policies share
// an Aho-Corasick automaton rather than scanning every pattern for every path.
const DIRECT_NAME_PATTERN_LIMIT = 32;
const MAX_NAME_MATCHER_STATES = 65_536;
interface NameState { readonly next: Map<string, number>; failure: number; rank: number; }
const nameState = (): NameState => ({ next: new Map(), failure: 0, rank: Infinity });

function compileNameMatcher(patterns: ReadonlyMap<string, number>): (name: string, last: string) => number {
  const direct = (name: string, last: string): number => {
    let rank = Infinity;
    for (const [pattern, candidate] of patterns) {
      if (candidate < rank && (name.includes(pattern) || last.includes(pattern))) rank = candidate;
      if (rank === 0) break;
    }
    return rank;
  };
  if (patterns.size <= DIRECT_NAME_PATTERN_LIMIT) return direct;

  const states = [nameState()];
  for (const [pattern, rank] of patterns) {
    let current = 0;
    // String.includes matches UTF-16 units, including isolated surrogates.
    for (let index = 0; index < pattern.length; index++) {
      const unit = pattern.charAt(index);
      let child = states[current]!.next.get(unit);
      if (child === undefined) {
        // An optimization must not retain an unbounded number of per-unit maps.
        if (states.length === MAX_NAME_MATCHER_STATES) { states.length = 0; return direct; }
        child = states.length;
        states.push(nameState());
        states[current]!.next.set(unit, child);
      }
      current = child;
    }
    states[current]!.rank = Math.min(states[current]!.rank, rank);
  }

  // Retain only the earliest matching source rank, not lists of suffix matches.
  const queue = [...states[0]!.next.values()];
  for (const child of queue) states[child]!.rank = Math.min(states[child]!.rank, states[0]!.rank);
  for (let head = 0; head < queue.length; head++) {
    const parent = states[queue[head]!]!;
    for (const [unit, childIndex] of parent.next) {
      let fallback = parent.failure;
      while (fallback !== 0 && !states[fallback]!.next.has(unit)) fallback = states[fallback]!.failure;
      const child = states[childIndex]!;
      child.failure = states[fallback]!.next.get(unit) ?? 0;
      child.rank = Math.min(child.rank, states[child.failure]!.rank);
      queue.push(childIndex);
    }
  }

  function match(name: string): number {
    let current = 0;
    let rank = states[0]!.rank;
    for (let index = 0; index < name.length && rank !== 0; index++) {
      const unit = name.charAt(index);
      while (current !== 0 && !states[current]!.next.has(unit)) current = states[current]!.failure;
      current = states[current]!.next.get(unit) ?? 0;
      rank = Math.min(rank, states[current]!.rank);
    }
    return rank;
  }
  return (name, last) => {
    const rank = match(name);
    return rank === 0 ? rank : Math.min(rank, match(last));
  };
}
