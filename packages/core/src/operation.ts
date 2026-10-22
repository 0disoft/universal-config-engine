import type { ConfigIssue, ConfigIssueCategory } from "./types.js";

/** Structural subset accepted by native AbortSignal, without a Node/DOM type dependency. */
export interface ConfigAbortSignal {
  readonly aborted: boolean;
  addEventListener(type: "abort", listener: () => void, options?: { readonly once?: boolean }): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

export interface ConfigOperationOptions { readonly signal?: ConfigAbortSignal; }

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
