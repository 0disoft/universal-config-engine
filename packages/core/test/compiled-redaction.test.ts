import { expect, it } from "vitest";
import fc from "fast-check";
import { compileRedaction } from "../src/compiled-redaction.js";
import { DEFAULT_SECRET_NAME_PATTERNS, type BuildDiagnosticReportOptions } from "../src/redaction.js";
import { isPathPrefix } from "../src/path.js";
import type { ConfigPath, ConfigSourceDescriptor } from "../src/types.js";

it("retains ordered policy reasons for typed prefixes, literal names, Unicode and atomic owners", () => {
  const path = fc.array(fc.constantFrom<string | number>("password", "a.b", "a", "0", 0, "Σ", "A"), { maxLength: 4 });
  const policy = fc.record({ secretPaths: fc.array(path, { maxLength: 4 }),
    secretNamePatterns: fc.array(fc.constantFrom("pass", "Σ", "σ", "ς", "A.B", "[a]", "", "0"), { maxLength: 4 }) });
  fc.assert(fc.property(fc.array(policy, { maxLength: 5 }), policy, fc.array(path, { maxLength: 3 }), path,
    (policies, options, owned, query) => {
      const sources: ConfigSourceDescriptor[] = policies.map((redaction, index) => ({
        id: `source-${index}`, displayName: "source", kind: "object", priority: index, redaction
      }));
      expect(compileRedaction(sources, options, DEFAULT_SECRET_NAME_PATTERNS, owned)(query))
        .toEqual(reference(sources, options, owned, query));
    }), { numRuns: 300 });
});

it("matches large policies exactly, including suffixes, empty strings and UTF-16 fragments", () => {
  const text = fc.array(fc.constantFrom("a", "b", "c", "Σ", "A", ".", "\ud83d", "\ude00", "[", "*"), { minLength: 1, maxLength: 10 }).map(units => units.join(""));
  const padding = Array.from({ length: 40 }, (_, index) => `unmatched-padding-${index}!`);
  fc.assert(fc.property(fc.array(fc.array(text, { maxLength: 8 }), { minLength: 1, maxLength: 5 }),
    fc.array(text, { maxLength: 4 }), (policies, query) => {
      const sources: ConfigSourceDescriptor[] = policies.map((patterns, index) => ({
        id: `source-${index}`, displayName: "source", kind: "object", priority: index,
        redaction: { secretNamePatterns: [...padding, ...patterns], secretPaths: index === 1 ? [query] : [] }
      }));
      expect(compileRedaction(sources, {}, DEFAULT_SECRET_NAME_PATTERNS, [])(query))
        .toEqual(reference(sources, {}, [], query));
    }), { numRuns: 500 });
});

it("inherits the earliest suffix rank without expanding overlapping match lists", () => {
  const padding = Array.from({ length: 40 }, (_, index) => `padding-${index}!`);
  const source = (id: string, secretNamePatterns: string[], secretPaths: ConfigPath[] = []): ConfigSourceDescriptor => ({
    id, displayName: id, kind: "object", priority: 0, redaction: { secretNamePatterns, secretPaths }
  });
  const sources = [source("first", [...padding, "bc", "\ud83d"]), source("second", ["abcd", ""], [["abcd"]])];
  for (const query of [["abcd"], ["aabcx"], ["😀"], ["abc", "AΣ"], [], ["public"]]) {
    expect(compileRedaction(sources, {}, [], [])(query)).toEqual(reference(sources, {}, [], query));
  }
  // Lowercasing the joined name can produce final sigma while the standalone
  // last segment produces ordinary sigma. Its earlier source must still win.
  const greekPath = ["A", "Σ"];
  const greekSources = [source("greek", [...padding, "σ"]), source("path", [], [greekPath])];
  expect(compileRedaction(greekSources, {}, [], [])(greekPath)).toEqual({ redacted: true, reason: "secret-name" });
  const overlapping = source("overlapping", Array.from({ length: 128 }, (_, index) => "a".repeat(index + 1) + "b"));
  expect(compileRedaction([overlapping], {}, [], [])(["a".repeat(4096) + "b"]))
    .toEqual({ redacted: true, reason: "secret-name" });
  expect(compileRedaction([overlapping], {}, [], [])(["a".repeat(4096)]))
    .toEqual({ redacted: false });
});

it("falls back without truncating oversized policies or changing their matches", () => {
  const patterns = Array.from({ length: 40 }, (_, index) => String(index).padStart(2, "0") + "x".repeat(2000));
  const match = compileRedaction([], { secretNamePatterns: [...patterns, "tail-marker"] }, [], []);
  expect(match(["tail-marker"])).toEqual({ redacted: true, reason: "secret-name" });
  expect(match([patterns.at(-1)!])).toEqual({ redacted: true, reason: "secret-name" });
  expect(match(["public"])).toEqual({ redacted: false });
});

it("retains ordered reasons and Unicode matches after the automaton overflows", () => {
  const padding = Array.from({ length: 40 }, (_, index) => String(index).padStart(2, "0") + "x".repeat(2000));
  const sources: ConfigSourceDescriptor[] = [
    { id: "first", displayName: "first", kind: "object", priority: 0,
      redaction: { secretNamePatterns: [...padding, "bc", "σ", "\ud83d"] } },
    { id: "second", displayName: "second", kind: "object", priority: 1,
      redaction: { secretPaths: [["abcd"], ["A", "Σ"], ["z"]], secretNamePatterns: ["tail-marker", ""] } }
  ];
  const match = compileRedaction(sources, {}, DEFAULT_SECRET_NAME_PATTERNS, []);
  const text = fc.array(fc.constantFrom("a", "b", "c", "Σ", "A", ".", "\ud83d", "\ude00", "[", "*"), { maxLength: 10 }).map(units => units.join(""));
  fc.assert(fc.property(fc.array(text, { maxLength: 5 }), query => {
    expect(match(query)).toEqual(reference(sources, {}, [], query));
  }), { numRuns: 300 });
  for (const query of [["abcd"], ["A", "Σ"], ["z"], ["q".repeat(5000)], ["q".repeat(1000) + "bc"]]) {
    expect(match(query)).toEqual(reference(sources, {}, [], query));
  }
});

it("verifies exact patterns despite length-filter collisions and long-name work limits", () => {
  const padding = Array.from({ length: 40 }, (_, index) => String(index).padStart(2, "0") + "x".repeat(2000));
  const patterns = [...padding, "z", "b".repeat(65_537), "c".repeat(31), "d".repeat(32)];
  const match = compileRedaction([], { secretNamePatterns: patterns }, [], []);
  expect(match(["a"])).toEqual({ redacted: false });
  expect(match(["z"])).toEqual({ redacted: true, reason: "secret-name" });
  expect(match([patterns[41]!])).toEqual({ redacted: true, reason: "secret-name" });
  expect(match(["a".repeat(2000)])).toEqual({ redacted: false });
  expect(match(["a".repeat(2000) + "c".repeat(31)])).toEqual({ redacted: true, reason: "secret-name" });
});

function reference(sources: readonly ConfigSourceDescriptor[], options: BuildDiagnosticReportOptions,
  owned: readonly ConfigPath[], path: ConfigPath) {
  if (owned.some(prefix => isPathPrefix(prefix, path))) return { redacted: true, reason: "secret-source" };
  const pathMatch = (paths: readonly ConfigPath[] | undefined) => paths?.some(prefix => isPathPrefix(prefix, path));
  const nameMatch = (patterns: readonly string[] | undefined) => patterns?.some(pattern =>
    [path.map(String).join("."), String(path.at(-1) ?? "")].some(name => name.toLowerCase().includes(pattern.toLowerCase())));
  for (const source of [...sources, undefined]) {
    if (pathMatch(source?.redaction?.secretPaths) || pathMatch(options.secretPaths)) return { redacted: true, reason: "secret-path" };
    if (nameMatch(source?.redaction?.secretNamePatterns) || nameMatch(options.secretNamePatterns) || nameMatch(DEFAULT_SECRET_NAME_PATTERNS)) {
      return { redacted: true, reason: "secret-name" };
    }
  }
  return { redacted: false };
}
