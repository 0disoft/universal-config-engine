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
        if (states.length === MAX_NAME_MATCHER_STATES) {
          states.length = 0;
          return compileOverflowNameMatcher(patterns);
        }
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

const NAME_LENGTH_FILTER_BITS = 65_536;
const MAX_OVERFLOW_QUERY_WORK = 4_096;

/** Reuse the dictionary with an 8 KiB filter; long names add a lazy 128 KiB query filter. */
function compileOverflowNameMatcher(patterns: ReadonlyMap<string, number>): (name: string, last: string) => number {
  const lengths = new Uint32Array(NAME_LENGTH_FILTER_BITS / 32);
  let minimum = Infinity;
  let maximum = 0;
  const emptyRank = patterns.get("") ?? Infinity;
  for (const pattern of patterns.keys()) {
    if (pattern.length === 0) continue;
    minimum = Math.min(minimum, pattern.length);
    maximum = Math.max(maximum, pattern.length);
    const bit = pattern.length % NAME_LENGTH_FILTER_BITS;
    const word = bit >>> 5;
    lengths[word] = lengths[word]! | (1 << (bit & 31));
  }
  function query(name: string): number | undefined {
    let rank = emptyRank;
    if (rank === 0) return rank;
    const upper = Math.min(maximum, name.length);
    if (minimum > upper) return rank;
    let work = upper - minimum + 1;
    if (work > MAX_OVERFLOW_QUERY_WORK) return undefined;
    // Plan first so a long, mixed-length name never starts an unbounded
    // substring enumeration. Filter collisions only add exact dictionary probes.
    for (let length = minimum; length <= upper; length++) {
      const bit = length % NAME_LENGTH_FILTER_BITS;
      if ((lengths[bit >>> 5]! & (1 << (bit & 31))) !== 0) work += (name.length - length + 1) * (length + 1);
      if (work > MAX_OVERFLOW_QUERY_WORK) return undefined;
    }
    for (let length = minimum; length <= upper; length++) {
      const bit = length % NAME_LENGTH_FILTER_BITS;
      if ((lengths[bit >>> 5]! & (1 << (bit & 31))) === 0) continue;
      for (let start = 0; start <= name.length - length; start++) {
        rank = Math.min(rank, patterns.get(name.slice(start, start + length)) ?? Infinity);
        if (rank === 0) return rank;
      }
    }
    return rank;
  }
  let stream: ((name: string, last: string) => number) | undefined;
  function streamQuery(name: string, last: string): number {
    stream ??= compileStreamingNameMatcher(patterns, emptyRank);
    return stream(name, last);
  }
  return (name, last) => {
    const rank = query(name);
    if (rank === undefined) return streamQuery(name, last);
    if (rank === 0 || name === last) return rank;
    const lastRank = query(last);
    return lastRank === undefined ? streamQuery(name, last) : Math.min(rank, lastRank);
  };
}

const STREAM_FILTER_BITS = 1_048_576;
const STREAM_FILTER_PROBES = 3;

/** Scan each query once, then reject patterns by their UTF-16 bigrams. */
function compileStreamingNameMatcher(
  patterns: ReadonlyMap<string, number>, emptyRank: number
): (name: string, last: string) => number {
  const filter = new Uint32Array(STREAM_FILTER_BITS / 32);
  function probe(pair: number, insert: boolean): boolean {
    const first = Math.imul(pair ^ (pair >>> 16), 0x85ebca6b);
    const step = Math.imul(pair ^ (pair >>> 13), 0xc2b2ae35) | 1;
    for (let index = 0; index < STREAM_FILTER_PROBES; index++) {
      const bit = (first + Math.imul(index, step)) & (STREAM_FILTER_BITS - 1);
      const word = bit >>> 5;
      const mask = 1 << (bit & 31);
      if (insert) filter[word] = filter[word]! | mask;
      else if ((filter[word]! & mask) === 0) return false;
    }
    return true;
  }
  function add(name: string): void {
    let previous = name.charCodeAt(0);
    let previousPair = NaN;
    for (let index = 1; index < name.length; index++) {
      const current = name.charCodeAt(index);
      const pair = (previous << 16) | current;
      if (pair !== previousPair) probe(pair, true);
      previousPair = pair;
      previous = current;
    }
  }
  function possibleAt(pattern: string, offset: number): boolean {
    return probe((pattern.charCodeAt(offset) << 16) | pattern.charCodeAt(offset + 1), false);
  }
  function possible(pattern: string): boolean {
    // Samples bound work per pattern, including very long policy strings.
    return possibleAt(pattern, 0) && possibleAt(pattern, (pattern.length - 2) >>> 1) && possibleAt(pattern, pattern.length - 2);
  }
  return (name, last) => {
    let rank = emptyRank;
    if (rank === 0) return rank;
    // Usually last is already a suffix; contextual Unicode lowercasing can
    // make the independently normalized segment differ from the joined name.
    const separate = !name.endsWith(last);
    filter.fill(0);
    add(name);
    if (separate) add(last);
    const upper = Math.max(name.length, last.length);
    for (const [pattern, candidate] of patterns) {
      if (candidate >= rank || pattern.length > upper) continue;
      if (pattern.length >= 2 && !possible(pattern)) continue;
      // Bloom collisions only schedule native exact searches. Do not allocate
      // substrings at every window, even for adversarial polynomial collisions.
      if (name.includes(pattern) || (separate && last.includes(pattern))) rank = candidate;
      if (rank === 0) break;
    }
    return rank;
  };
}
