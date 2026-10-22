import type { ConfigIssue, ConfigIssueCategory } from "./types.js";

/** Structural subset accepted by native AbortSignal, without a Node/DOM type dependency. */
export interface ConfigAbortSignal {
  readonly aborted: boolean;
  readonly reason?: unknown;
  addEventListener(type: "abort", listener: () => void, options?: { readonly once?: boolean }): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

export interface ConfigOperationError {
  readonly code: string;
  readonly sourceId?: string;
  /** Private operational context. Never attach this error to reports or log it by default. */
  readonly error: Error;
}

export interface ConfigOperationOptions {
  readonly signal?: ConfigAbortSignal;
  readonly onError?: (failure: ConfigOperationError) => void | Promise<void>;
}

/** Out-of-band failure reporting; observer failures cannot change operation outcomes. */
export function reportConfigOperationError(options: ConfigOperationOptions, code: string, cause: unknown, sourceId?: string): void {
  if (options.onError === undefined) return;
  try {
    const observed = options.onError(Object.freeze({ code,
      ...(sourceId === undefined ? {} : { sourceId }),
      error: new Error("Configuration operation failed.", { cause }) }));
    if (observed !== undefined) void Promise.resolve(observed).catch(() => {});
  } catch { /* Error observers are isolated from the operation being reported. */ }
}

export function operationAbortedIssue(category: ConfigIssueCategory, sourceId?: string): ConfigIssue {
  return { category, code: "operation_aborted", severity: "error",
    message: "Configuration operation was cancelled.", ...(sourceId === undefined ? {} : { sourceId }) };
}

/** Stop waiting without claiming to stop a callback that ignores cancellation. */
export async function runAbortable<T>(operation: () => T | PromiseLike<T>, signal?: ConfigAbortSignal):
Promise<{ readonly aborted: true } | { readonly aborted: false; readonly value: T }> {
  if (signal === undefined) return { aborted: false, value: await operation() };
  if (signal.aborted) return { aborted: true };
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      action();
    };
    const abort = () => finish(() => resolve({ aborted: true }));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { abort(); return; }
    try {
      Promise.resolve(operation()).then(value => {
        if (signal.aborted) abort();
        else finish(() => resolve({ aborted: false, value }));
      }, error => {
        if (signal.aborted) abort();
        else finish(() => reject(error));
      });
    } catch (error) {
      if (signal.aborted) abort();
      else finish(() => reject(error));
    }
  });
}
