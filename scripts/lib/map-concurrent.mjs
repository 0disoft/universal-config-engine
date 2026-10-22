/** Bounded, ordered reads. Operations must cooperate with the owned cancellation signal. */
export async function mapConcurrent(items, concurrency, operation, { signal } = {}) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new RangeError("Concurrency must be a positive safe integer.");
  const controller = new AbortController();
  const results = new Array(items.length);
  let cursor = 0;
  let failed = false;
  let failure;
  function fail(error) {
    if (failed) return;
    failed = true;
    failure = error;
    controller.abort(error);
  }
  const abort = () => fail(signal.reason);
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signal?.aborted) abort();
    async function worker() {
      while (!failed && cursor < items.length) {
        const index = cursor++;
        try { results[index] = await operation(items[index], index, controller.signal); }
        catch (error) { fail(error); }
      }
    }
    // Only the bounded workers get promises; queued items remain ordinary array entries.
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
    if (failed) throw failure;
    return results;
  } finally { signal?.removeEventListener("abort", abort); }
}
