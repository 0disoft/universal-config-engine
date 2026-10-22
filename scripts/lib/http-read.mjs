import { setTimeout as delay } from "node:timers/promises";

const TRANSIENT_CODES = new Set(["EAI_AGAIN", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET"]);

export class HttpReadError extends Error {
  constructor(message, { cause, status, retryable = false, retryAfterMs = 0 } = {}) {
    super(message, { cause });
    this.name = "HttpReadError";
    this.status = status;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

function transientTransport(error) {
  const seen = new Set();
  for (let depth = 0; error && typeof error === "object" && depth < 8 && !seen.has(error); depth++) {
    seen.add(error);
    if (typeof error.code === "string") return TRANSIENT_CODES.has(error.code);
    error = error.cause;
  }
  return false;
}

/** GET only. The shared deadline includes response bodies, retries and backoff. */
export async function readJson(url, {
  headers, fetchImpl = fetch, signal, timeoutMs = 10_000, maxRetries = 2,
  allowNotFound = false, now = () => performance.now(), sleep = (ms, options) => delay(ms, undefined, options),
  random = Math.random
} = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647 ||
      !Number.isSafeInteger(maxRetries) || maxRetries < 0 || maxRetries > 10) {
    throw new RangeError("Invalid HTTP read timeout or retry count.");
  }
  const controller = new AbortController();
  const deadline = now() + timeoutMs;
  let lastFailure;
  let reject;
  const interrupted = new Promise((_resolve, fail) => { reject = fail; });
  void interrupted.catch(() => {});
  const interrupt = error => { reject(error); controller.abort(error); };
  const abort = () => interrupt(new HttpReadError("HTTP read was cancelled.", { cause: signal.reason }));
  const timer = setTimeout(() => interrupt(new HttpReadError("HTTP read timed out.", { cause: lastFailure, retryable: true })), timeoutMs);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const wait = work => Promise.race([work, interrupted]);
  async function request() {
    const response = await fetchImpl(url, { method: "GET", headers, signal: controller.signal });
    if (!response.ok) {
      // Do not retain an unread response body or let its disposal block failure reporting.
      void response.body?.cancel().catch(() => {});
      if (response.status === 404 && allowNotFound) return undefined;
      const retryAfter = response.headers?.get("retry-after");
      const seconds = Number(retryAfter);
      const retryAfterMs = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000
        : Math.max(0, Date.parse(retryAfter) - Date.now());
      throw new HttpReadError(`HTTP read failed with HTTP ${response.status}.`, {
        status: response.status, retryable: [408, 429, 500, 502, 503, 504].includes(response.status),
        retryAfterMs: Number.isFinite(retryAfterMs) ? retryAfterMs : 0
      });
    }
    try { return await response.json(); }
    catch (cause) {
      if (cause instanceof SyntaxError) throw new HttpReadError("HTTP read returned invalid JSON.", { cause });
      throw cause;
    }
  }
  try {
    for (let attempt = 0; ; attempt++) {
      if (controller.signal.aborted) return await interrupted;
      try { return await wait(request()); }
      catch (cause) {
        if (controller.signal.aborted) return await interrupted;
        const error = cause instanceof HttpReadError ? cause
          : new HttpReadError("HTTP read transport failed.", { cause, retryable: transientTransport(cause) });
        lastFailure = error;
        const remaining = deadline - now();
        const backoff = Math.max(error.retryAfterMs, Math.floor(random() * Math.min(2000, 200 * 2 ** attempt)));
        if (!error.retryable || attempt >= maxRetries || remaining <= backoff) throw error;
        await wait(sleep(backoff, { signal: controller.signal }));
      }
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    controller.abort();
  }
}
