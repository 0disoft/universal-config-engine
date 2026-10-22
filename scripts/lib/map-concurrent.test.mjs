import { test } from "node:test";
import assert from "node:assert/strict";
import { mapConcurrent } from "./map-concurrent.mjs";

test("bounds active reads and preserves input order despite reversed completions", async () => {
  let active = 0; let peak = 0;
  const result = await mapConcurrent(Array.from({ length: 13 }, (_, i) => i), 4, async value => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, (4 - value % 4) * 2));
    active--; return value * 2;
  });
  assert.equal(peak, 4);
  assert.equal(active, 0);
  assert.deepEqual(result, Array.from({ length: 13 }, (_, i) => i * 2));
});

test("stops queued reads, cancels siblings and retains the original failure", async () => {
  const failure = new Error("read failed");
  const started = []; let cancelled = 0;
  await assert.rejects(mapConcurrent([0, 1, 2, 3, 4, 5], 3, async (value, _index, signal) => {
    started.push(value);
    if (value === 0) { await Promise.resolve(); throw failure; }
    await new Promise((_resolve, reject) => signal.addEventListener("abort", () => {
      cancelled++; reject(signal.reason);
    }, { once: true }));
  }), error => error === failure);
  assert.deepEqual(started, [0, 1, 2]);
  assert.equal(cancelled, 2);
});

test("propagates cancellation without claiming queued reads", async () => {
  const controller = new AbortController(); const reason = new Error("cancelled");
  const started = [];
  const pending = mapConcurrent([0, 1, 2, 3], 2, async (value, _index, signal) => {
    started.push(value);
    await new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  }, { signal: controller.signal });
  controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
  assert.deepEqual(started, [0, 1]);
  await assert.rejects(mapConcurrent([1], 2, () => assert.fail("must not start"), { signal: controller.signal }), error => error === reason);
});

test("validates worker limits and handles empty inputs", async () => {
  for (const limit of [0, -1, NaN, Infinity, 1.5]) await assert.rejects(mapConcurrent([], limit, () => {}), RangeError);
  assert.deepEqual(await mapConcurrent([], 4, () => assert.fail()), []);
});
