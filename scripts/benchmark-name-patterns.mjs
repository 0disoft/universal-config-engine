import { performance } from "node:perf_hooks";
import { compileRedaction } from "../packages/core/dist/compiled-redaction.js";
import { DEFAULT_SECRET_NAME_PATTERNS } from "../packages/core/dist/redaction.js";

// Report-local compilation is included. These synthetic paths deliberately miss
// every pattern, so early successful matches cannot hide exhaustive scans.
const queries = Array.from({ length: 4096 }, (_, index) => ["service", `public_field_${index}`]);
for (const count of [16, 256, 4096]) {
  const patterns = Array.from({ length: count }, (_, index) => `secret_marker_${index}_end`);
  const run = () => {
    const match = compileRedaction([], { secretNamePatterns: patterns }, [], []);
    for (const path of queries) if (match(path).redacted) throw new Error("Unexpected benchmark match.");
  };
  run();
  const times = [];
  for (let repeat = 0; repeat < 5; repeat++) {
    const start = performance.now(); run(); times.push(performance.now() - start);
  }
  times.sort((left, right) => left - right);
  console.log(JSON.stringify({ patterns: count, paths: queries.length, medianMs: times[2] }));
}

// Both policies exceed the automaton state budget. Track compilation separately
// from queries and optionally measure retained heap/buffer storage after GC.
for (const fixture of [
  { name: "overflow-many-distinct", patterns: Array.from({ length: 8192 }, (_, index) => String(index).padStart(5, "0") + "_sensitive_marker") },
  { name: "overflow-long-patterns", patterns: Array.from({ length: 40 }, (_, index) => String(index).padStart(2, "0") + "x".repeat(2000)) }
]) {
  const paths = Array.from({ length: 4096 }, (_, index) => ["service", "public_field_" + String(index).padStart(6, "0")]);
  const run = () => {
    const start = performance.now();
    const match = compileRedaction([], { secretNamePatterns: fixture.patterns }, [], []);
    const compiled = performance.now();
    for (const path of paths) if (match(path).redacted) throw new Error("Unexpected overflow match.");
    return { compileMs: compiled - start, queryMs: performance.now() - compiled };
  };
  run();
  const times = Array.from({ length: 3 }, run).sort((left, right) => left.compileMs + left.queryMs - right.compileMs - right.queryMs);
  console.log(JSON.stringify({ name: fixture.name, patterns: fixture.patterns.length, paths: paths.length, ...times[1] }));
  if (global.gc !== undefined) console.log(JSON.stringify({ name: fixture.name, ...measureRetained(fixture.patterns) }));
}

for (const length of [4096, 16_384, 65_536]) {
  const patterns = Array.from({ length: 8192 }, (_, index) => String(index).padStart(5, "0") + "_sensitive_marker");
  const paths = Array.from({ length: 32 }, (_, index) => ["service", "q".repeat(length) + String(index).padStart(6, "0")]);
  const match = compileRedaction([], { secretNamePatterns: patterns }, [], []);
  const run = () => {
    const start = performance.now();
    for (const path of paths) if (match(path).redacted) throw new Error("Unexpected long-name match.");
    return performance.now() - start;
  };
  const firstQueryBatchMs = run();
  const times = Array.from({ length: 3 }, run).sort((left, right) => left - right);
  console.log(JSON.stringify({ name: "overflow-long-names", patterns: patterns.length, paths: paths.length,
    nameUnits: length, firstQueryBatchMs, queryMedianMs: times[1] }));
}

// Include the real default policy, and report the lazy first-query cost as well.
for (const length of [256, 1024, 4096]) {
  const patterns = Array.from({ length: 8192 }, (_, index) => String(index).padStart(5, "0") + "_sensitive_marker");
  const match = compileRedaction([], { secretNamePatterns: patterns }, DEFAULT_SECRET_NAME_PATTERNS, []);
  const run = () => {
    const start = performance.now();
    for (let index = 0; index < 32; index++) if (match(["service", "q".repeat(length) + index]).redacted) throw new Error("Unexpected short-name match.");
    return performance.now() - start;
  };
  const firstQueryBatchMs = run();
  const times = Array.from({ length: 5 }, run).sort((left, right) => left - right);
  console.log(JSON.stringify({ name: "overflow-short-names-with-defaults", nameUnits: length, paths: 32,
    firstQueryBatchMs, queryMedianMs: times[2] }));
}

// Distinct lengths multiply rolling-window passes; equal polynomial hashes
// multiply exact substring probes even when no literal pattern matches.
for (const fixture of [
  { name: "overflow-many-lengths", candidates: Array.from({ length: 512 }, (_, index) => "a".repeat(index + 2) + "b"), value: "q".repeat(16_384) },
  { name: "overflow-hash-collisions", candidates: Array.from({ length: 128 }, (_, index) => "a~".repeat(index + 2)), value: "b_".repeat(8192) },
  ...[512, 2048].map(count => ({ name: `overflow-all-pair-hits-${count}`,
    candidates: Array.from({ length: count }, (_, index) => "ab" + "x".repeat(index + 8) + "cd"),
    value: "abxxcd".repeat(2731) })),
  { name: "overflow-all-gram-hits", candidates: Array.from({ length: 512 }, (_, index) => "ab" + "x".repeat(index + 8) + "cd"),
    value: "abxxxxcd".repeat(2048) }
]) {
  const padding = Array.from({ length: 40 }, (_, index) => String(index).padStart(2, "0") + "x".repeat(2000));
  const match = compileRedaction([], { secretNamePatterns: [...padding, ...fixture.candidates] }, [], []);
  const run = () => {
    const start = performance.now();
    for (let index = 0; index < 8; index++) if (match(["service", fixture.value + index]).redacted) throw new Error("Unexpected adversarial match.");
    return performance.now() - start;
  };
  const firstQueryBatchMs = run();
  const times = Array.from({ length: 7 }, run).sort((left, right) => left - right);
  console.log(JSON.stringify({ name: fixture.name, paths: 8, firstQueryBatchMs, queryMedianMs: times[3] }));
}

for (const fixture of [
  { name: "overflow-diverse-suffixes", patterns: Array.from({ length: 8192 }, (_, index) => String(index).padStart(5, "0") + "_sensitive_" + String(index).padStart(5, "0")), tail: "" },
  { name: "overflow-incidental-suffix", patterns: Array.from({ length: 8192 }, (_, index) => String(index).padStart(5, "0") + "_sensitive_marker"), tail: "_sensitive_marker" }
]) {
  const match = compileRedaction([], { secretNamePatterns: fixture.patterns }, DEFAULT_SECRET_NAME_PATTERNS, []);
  const run = () => {
    const start = performance.now();
    for (let index = 0; index < 128; index++) if (match(["service", "q".repeat(256) + fixture.tail]).redacted) throw new Error("Unexpected suffix-fallback match.");
    return performance.now() - start;
  };
  const firstQueryBatchMs = run();
  const times = Array.from({ length: 5 }, run).sort((left, right) => left - right);
  console.log(JSON.stringify({ name: fixture.name, paths: 128, firstQueryBatchMs, queryMedianMs: times[2] }));
}

// Every existing start/middle/end sample occurs, but the numeric portion does not.
// Keep paths outside timing to isolate matching from fixture allocation.
for (const length of [4096, 16_384]) {
  const patterns = Array.from({ length: 8192 }, (_, index) => "0000" + String(index).padStart(5, "0") + "_sensitive_marker");
  const paths = Array.from({ length: 4 }, (_, index) => ["service", "0000" + "q".repeat(length) + index + "_sensitive_marker"]);
  const match = compileRedaction([], { secretNamePatterns: patterns }, [], []);
  const run = () => {
    const start = performance.now();
    for (const path of paths) if (match(path).redacted) throw new Error("Unexpected positive-prefix match.");
    return performance.now() - start;
  };
  const firstQueryBatchMs = run();
  run();
  const times = Array.from({ length: 7 }, run).sort((left, right) => left - right);
  console.log(JSON.stringify({ name: "overflow-positive-prefix", nameUnits: length, paths: paths.length,
    firstQueryBatchMs, queryMedianMs: times[3] }));
}

function measureRetained(patterns) {
  // Keep each measured matcher in its own call frame so a prior iteration's
  // matcher cannot remain live across the next before/after GC pair.
  global.gc(); const before = process.memoryUsage();
  const match = compileRedaction([], { secretNamePatterns: patterns }, [], []);
  global.gc(); const after = process.memoryUsage();
  return { heapRetainedDelta: after.heapUsed - before.heapUsed,
    arrayBufferDelta: after.arrayBuffers - before.arrayBuffers, matched: match(["public"]).redacted };
}
