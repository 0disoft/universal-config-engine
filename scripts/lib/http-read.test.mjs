import assert from "node:assert/strict";
import test from "node:test";
import { readJson } from "./http-read.mjs";

test("GET retries only transient reads with bounded exponential jitter", async () => {
  const pauses = [];
  let calls = 0;
  const result = await readJson("https://example.invalid", { random: () => 0.5,
    sleep: async ms => { pauses.push(ms); }, fetchImpl: async (_url, options) => {
      assert.equal(options.method, "GET");
      assert(options.signal instanceof AbortSignal);
      if (++calls < 3) throw new TypeError("reset", { cause: { code: "ECONNRESET" } });
      return Response.json({ ok: true });
    } });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(pauses, [100, 200]);
  assert.equal(calls, 3);
});

test("authentication, certificate and unknown transport failures receive zero retries", async () => {
  for (const failure of [new TypeError("unknown"), new TypeError("certificate", { cause: { code: "CERT_HAS_EXPIRED" } }),
    new Response("", { status: 403 })]) {
    let calls = 0;
    await assert.rejects(readJson("https://example.invalid", { fetchImpl: async () => {
      calls++; if (failure instanceof Error) throw failure; return failure;
    } }), error => error.retryable === false && (failure instanceof Response || error.cause === failure));
    assert.equal(calls, 1);
  }
});

test("malformed JSON retains its SyntaxError cause without retries", async () => {
  let calls = 0;
  await assert.rejects(readJson("https://example.invalid", { fetchImpl: async () => {
    calls++; return new Response("bad json");
  } }), error => /invalid JSON/.test(error.message) && error.cause instanceof SyntaxError);
  assert.equal(calls, 1);
});

test("one deadline covers retries and response body reading", async () => {
  let signal;
  let calls = 0;
  await assert.rejects(readJson("https://example.invalid", { timeoutMs: 5,
    fetchImpl: async (_url, options) => { calls++; signal = options.signal;
      return { ok: true, json: () => new Promise(() => {}) }; }
  }), /timed out/);
  assert.equal(calls, 1);
  assert.equal(signal.aborted, true);
});

test("backoff cannot exceed the shared deadline or Retry-After", async () => {
  let time = 0, calls = 0;
  await assert.rejects(readJson("https://example.invalid", { timeoutMs: 150, now: () => time, random: () => 0.5,
    sleep: async ms => { time += ms; }, fetchImpl: async () => { calls++; return new Response("", { status: 503 }); }
  }), /HTTP 503/);
  assert.equal(calls, 2); assert.equal(time, 100);
  calls = 0;
  await assert.rejects(readJson("https://example.invalid", { timeoutMs: 150, fetchImpl: async () => {
    calls++; return new Response("", { status: 429, headers: { "retry-after": "60" } });
  } }), /HTTP 429/);
  assert.equal(calls, 1);
});

test("pre-cancellation skips fetch and cancellation interrupts backoff", async () => {
  for (const before of [true, false]) {
    const controller = new AbortController();
    const cause = new Error("private cancellation reason");
    let calls = 0;
    if (before) controller.abort(cause);
    await assert.rejects(readJson("https://example.invalid", { signal: controller.signal,
      fetchImpl: async () => { calls++; return new Response("", { status: 503 }); },
      sleep: async () => { controller.abort(cause); return new Promise(() => {}); }
    }), error => error.cause === cause && error.retryable === false);
    assert.equal(calls, before ? 0 : 1);
  }
});

test("404 is missing only when the caller explicitly allows it", async () => {
  const options = { fetchImpl: async () => new Response("", { status: 404 }) };
  assert.equal(await readJson("https://example.invalid", { ...options, allowNotFound: true }), undefined);
  await assert.rejects(readJson("https://example.invalid", options), /HTTP 404/);
});
