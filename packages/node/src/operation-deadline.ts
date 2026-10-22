import type { ConfigAbortSignal } from "@0disoft/universal-config-engine-core";

export const DEFAULT_OPERATION_TIMEOUT_MS = 30_000;
export class OperationTimeoutError extends Error {
  constructor() { super("Configuration operation exceeded its deadline."); this.name = "OperationTimeoutError"; }
}

export function operationTimeout(value = DEFAULT_OPERATION_TIMEOUT_MS): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) {
    throw new RangeError("Operation timeout must be an integer between 1 and 2147483647 milliseconds.");
  }
  return value;
}

/** Own both cancellation and timer lifetime without pretending to force-stop work. */
export function createOperationDeadline(parent: ConfigAbortSignal, timeoutMs: number): {
  readonly signal: ConfigAbortSignal;
  dispose(): void;
  waitFor<T>(work: T | PromiseLike<T>): Promise<T>;
} {
  const controller = new AbortController();
  let reject!: (error: Error) => void;
  const interrupted = new Promise<never>((_resolve, fail) => { reject = fail; });
  // A callback can synchronously abort its parent before waitFor is attached.
  void interrupted.catch(() => {});
  const abort = () => {
    const error = new Error("Configuration operation was cancelled.", { cause: parent.reason });
    error.name = "AbortError";
    reject(error);
    controller.abort(parent.reason);
  };
  const timer = setTimeout(() => {
    const error = new OperationTimeoutError();
    reject(error);
    controller.abort(error);
  }, timeoutMs);
  const dispose = () => {
    clearTimeout(timer);
    parent.removeEventListener("abort", abort);
    controller.abort();
  };
  parent.addEventListener("abort", abort, { once: true });
  if (parent.aborted) abort();
  return {
    signal: controller.signal,
    dispose,
    async waitFor<T>(work: T | PromiseLike<T>): Promise<T> {
      try { return await Promise.race([work, interrupted]); }
      finally { dispose(); }
    }
  };
}
