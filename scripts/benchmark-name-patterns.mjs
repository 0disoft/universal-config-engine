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
