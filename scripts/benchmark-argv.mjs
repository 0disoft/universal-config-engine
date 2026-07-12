import { performance } from "node:perf_hooks";
import { createArgvSource } from "../packages/node/dist/index.js";

const WARMUP_RUNS = 2;
const SAMPLE_RUNS = 5;
const SIZES = [256, 1024, 4096];
const results = [];

for (const size of SIZES) {
  const input = createInput(size);
  for (let index = 0; index < WARMUP_RUNS; index += 1) {
    runScenario(input, size);
  }

  const samples = [];
  for (let index = 0; index < SAMPLE_RUNS; index += 1) {
    const startedAt = performance.now();
    runScenario(input, size);
    samples.push(performance.now() - startedAt);
  }

  results.push({
    size,
    samplesMs: samples.map(roundMilliseconds),
    minMs: roundMilliseconds(Math.min(...samples)),
    medianMs: roundMilliseconds(median(samples)),
    maxMs: roundMilliseconds(Math.max(...samples))
  });
}

process.stdout.write(`${JSON.stringify({
  benchmark: "argv-single-scan",
  node: process.version,
  warmupRuns: WARMUP_RUNS,
  sampleRuns: SAMPLE_RUNS,
  results
}, null, 2)}\n`);

function createInput(size) {
  return {
    descriptor: {
      id: "argv",
      kind: "argv",
      priority: 10,
      displayName: "argv"
    },
    argv: Array.from({ length: size }, (_, index) => `--key-${index}=${index}`),
    mappings: Array.from({ length: size }, (_, index) => ({
      externalName: `--key-${index}`,
      sourceKind: "argv",
      targetPath: [`key${index}`],
      parseAs: "number"
    }))
  };
}

function runScenario(input, size) {
  const source = createArgvSource(input);
  assertEqual(source.issues?.length ?? 0, 0, `${size} issue count`);
  assertEqual(source.value.key0, 0, `${size} first value`);
  assertEqual(source.value[`key${size - 1}`], size - 1, `${size} last value`);
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
