import { performance } from "node:perf_hooks";
import { buildDiagnosticReport, resolveConfig } from "../packages/core/dist/index.js";

const WARMUP_RUNS = 2;
const SAMPLE_RUNS = 5;
const WIDE_KEY_COUNT = 10_000;
const SUBTREE_KEY_COUNT = 10_000;
const wideSources = [
  objectSource("left", 1, createWideObject(WIDE_KEY_COUNT, 0)),
  objectSource("right", 1, createWideObject(WIDE_KEY_COUNT, 1))
];
const subtreeSources = [
  objectSource("base", 0, { root: createWideObject(SUBTREE_KEY_COUNT, 0) }),
  objectSource("override", 10, { root: "replaced" })
];
const locatedSource = objectSource("located", 0, createWideObject(WIDE_KEY_COUNT, 0));
locatedSource.locations = Array.from({ length: WIDE_KEY_COUNT }, (_, index) => ({
  path: [`key-${index}`],
  location: {
    sourceId: "located",
    sourcePath: "config.json",
    line: index + 1,
    column: 1
  }
}));

const scenarios = [
  {
    name: "wide-same-priority-conflicts",
    run: runWideSamePriorityConflicts
  },
  {
    name: "large-subtree-replacement",
    run: runLargeSubtreeReplacement
  },
  {
    name: "wide-locations-and-report",
    run: runWideLocationsAndReport
  }
];

const results = [];
for (const scenario of scenarios) {
  for (let index = 0; index < WARMUP_RUNS; index += 1) {
    scenario.run();
  }

  const samples = [];
  for (let index = 0; index < SAMPLE_RUNS; index += 1) {
    const startedAt = performance.now();
    scenario.run();
    samples.push(performance.now() - startedAt);
  }

  results.push({
    name: scenario.name,
    samplesMs: samples.map(roundMilliseconds),
    minMs: roundMilliseconds(Math.min(...samples)),
    medianMs: roundMilliseconds(median(samples)),
    maxMs: roundMilliseconds(Math.max(...samples))
  });
}

function runWideLocationsAndReport() {
  const result = resolveConfig({ sources: [locatedSource] });
  const report = buildDiagnosticReport(result);
  assertEqual(result.resolvedPaths.length, WIDE_KEY_COUNT, "located resolved path count");
  assertEqual(report.resolvedPaths.length, WIDE_KEY_COUNT, "located report path count");
  assertEqual(report.resolvedPaths[0]?.winningLocation?.line, 1, "first source location line");
  assertEqual(
    report.resolvedPaths.at(-1)?.winningLocation?.line,
    WIDE_KEY_COUNT,
    "last source location line"
  );
}

process.stdout.write(`${JSON.stringify({
  benchmark: "merge-path-trie",
  node: process.version,
  warmupRuns: WARMUP_RUNS,
  sampleRuns: SAMPLE_RUNS,
  workloads: {
    wideKeyCount: WIDE_KEY_COUNT,
    subtreeKeyCount: SUBTREE_KEY_COUNT
  },
  results
}, null, 2)}\n`);

function runWideSamePriorityConflicts() {
  const result = resolveConfig({
    sources: wideSources,
    limits: {
      maxDiagnostics: 200
    }
  });

  assertEqual(result.resolvedPaths.length, WIDE_KEY_COUNT, "wide resolved path count");
  assertEqual(result.issues.length, 200, "wide diagnostic count");
  assertEqual(
    result.issues.at(-1)?.code,
    "max_diagnostics_exceeded",
    "wide diagnostic overflow marker"
  );
}

function runLargeSubtreeReplacement() {
  const result = resolveConfig({
    sources: subtreeSources,
    limits: {
      maxKeyCount: SUBTREE_KEY_COUNT + 1
    }
  });

  assertEqual(result.resolvedPaths.length, 1, "subtree replacement resolved path count");
  assertEqual(result.resolvedPaths[0]?.path.join("."), "root", "subtree replacement winner path");
  assertEqual(result.issues.length, 0, "subtree replacement diagnostic count");
}

function objectSource(id, priority, value) {
  return {
    descriptor: {
      id,
      kind: "object",
      priority,
      displayName: id
    },
    value
  };
}

function createWideObject(keyCount, offset) {
  return Object.fromEntries(
    Array.from({ length: keyCount }, (_, index) => [`key-${index}`, index + offset])
  );
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function roundMilliseconds(value) {
  return Math.round(value * 100) / 100;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, received ${String(actual)}.`);
  }
}
