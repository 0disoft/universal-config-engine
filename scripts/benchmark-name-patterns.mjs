import { performance } from "node:perf_hooks";
import { compileRedaction } from "../packages/core/dist/compiled-redaction.js";

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

function measureRetained(patterns) {
  // Keep each measured matcher in its own call frame so a prior iteration's
  // matcher cannot remain live across the next before/after GC pair.
  global.gc(); const before = process.memoryUsage();
  const match = compileRedaction([], { secretNamePatterns: patterns }, [], []);
  global.gc(); const after = process.memoryUsage();
  return { heapRetainedDelta: after.heapUsed - before.heapUsed,
    arrayBufferDelta: after.arrayBuffers - before.arrayBuffers, matched: match(["public"]).redacted };
}
