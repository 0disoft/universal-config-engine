import { createOperationDeadline, operationTimeout } from "./operation-deadline.js";
import type { CreateConfigReloaderInput } from "./reload.js";

/** Bound metadata-only setup; late I/O must not start another step or acquire handles. */
export async function runWatchSetup<T>(
  input: Pick<CreateConfigReloaderInput, "signal" | "loadTimeoutMs">,
  operation: (assertActive: () => void) => Promise<T>
): Promise<T> {
  const deadline = createOperationDeadline(input.signal ?? new AbortController().signal, operationTimeout(input.loadTimeoutMs));
  const assertActive = () => {
    if (deadline.signal.aborted) throw new Error("Configuration watch setup was cancelled.");
  };
  try {
    assertActive();
    return await deadline.waitFor(operation(assertActive).then(value => {
      assertActive();
      return value;
    }));
  } finally { deadline.dispose(); }
}
