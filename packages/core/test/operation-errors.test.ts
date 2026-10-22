import { describe, expect, it } from "vitest";
import { runConfigPipeline, runValidatedConfigPipeline, type ConfigOperationError } from "../src/index.js";

const descriptor = { id: "external", kind: "object" as const, priority: 0, displayName: "external" };

describe("private operation errors", () => {
  it("forwards the error hook to loaders and preserves causes outside public results", async () => {
    const cause = new Error("PRIVATE_TRANSPORT_DETAIL");
    const observed: ConfigOperationError[] = [];
    const onError = (error: ConfigOperationError) => { observed.push(error); };
    const result = await runConfigPipeline({ context: undefined, onError, loaders: [{ descriptor,
      load(_context, options) { expect(options?.onError).toBe(onError); throw cause; }
    }] });
    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({ code: "loader_threw", sourceId: "external" });
    expect(observed[0]?.error.cause).toBe(cause);
    expect(result.result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_TRANSPORT_DETAIL");
  });

  it("captures ordinary and typed validator failures without changing diagnostics", async () => {
    const cause = { private: "PRIVATE_VALIDATOR_DETAIL" };
    for (const typed of [false, true]) {
      const observed: ConfigOperationError[] = [];
      const validator = { id: "external-validator", validate() { throw cause; } };
      const input = { context: undefined, loaders: [], onError: (error: ConfigOperationError) => { observed.push(error); } };
      const result = typed ? await runValidatedConfigPipeline({ ...input, outputValidator: validator })
        : await runConfigPipeline({ ...input, validators: [validator] });
      expect(observed[0]?.error.cause).toBe(cause);
      expect(observed[0]?.code).toBe("validator_threw");
      expect(result.result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain("PRIVATE_VALIDATOR_DETAIL");
    }
  });

  it.each([false, true])("contains failures of the error observer (async: %s)", async asynchronous => {
    const result = await runConfigPipeline({ context: undefined, loaders: [{ descriptor, load() { throw new Error(); } }],
      onError() { if (asynchronous) return Promise.reject(new Error("observer failed")); throw new Error("observer failed"); }
    });
    expect(result.result.issues[0]?.code).toBe("loader_threw");
    await Promise.resolve();
  });
});
