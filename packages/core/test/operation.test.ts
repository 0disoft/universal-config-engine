import { describe, expect, it, vi } from "vitest";
import { loadConfigSources, runConfigPipeline, runValidatedConfigPipeline, runValidators } from "../src/index.js";

const descriptor = { id: "settings", kind: "object" as const, priority: 0, displayName: "settings" };

describe("optional operation cancellation", () => {
  it("skips loaders and config cloning when already cancelled", async () => {
    const controller = new AbortController(); controller.abort("private cancellation reason");
    const load = vi.fn(() => ({ value: {} }));
    const result = await runConfigPipeline({ signal: controller.signal, context: undefined, loaders: [{ descriptor, load }] });
    expect(load).not.toHaveBeenCalled();
    expect(result.result.ok).toBe(false);
    expect(result.result.issues[0]?.code).toBe("operation_aborted");
    expect(JSON.stringify(result.report)).not.toContain("private cancellation reason");
    const config = { get value(): string { throw new Error("Must not clone cancelled input"); } };
    expect((await runValidators({ config, provenance: [], validators: [], signal: controller.signal })).issues[0]?.code)
      .toBe("operation_aborted");
  });

  it("cancels a pending loader, skips subsequent loaders and keeps pipeline failure", async () => {
    const controller = new AbortController();
    let reject!: (error: Error) => void;
    const later = vi.fn(() => ({ value: {} }));
    const pending = runConfigPipeline({ context: undefined, signal: controller.signal, loaders: [
      { descriptor, load: () => ({ value: { port: 80 } }) },
      { descriptor: { ...descriptor, id: "pending" }, load: (_context, options) => {
        expect(options?.signal).toBe(controller.signal);
        return new Promise((_resolve, fail) => { reject = fail; controller.abort(); });
      } },
      { descriptor: { ...descriptor, id: "later" }, load: later }
    ] });
    const result = await pending;
    expect(result.result.ok).toBe(false);
    expect(result.report.status).toBe("error");
    expect(result.result.issues).toContainEqual(expect.objectContaining({ code: "operation_aborted" }));
    expect(later).not.toHaveBeenCalled();
    reject(new Error("late rejection must be observed"));
    await Promise.resolve();
  });

  it("cancels pending validation without calling following validators", async () => {
    const controller = new AbortController();
    const later = vi.fn(() => ({ ok: true, issues: [] }));
    const pending = runValidators({ config: {}, provenance: [], signal: controller.signal, validators: [
      { id: "pending", validate: input => {
        expect(input.signal).toBe(controller.signal);
        controller.abort(); return new Promise(() => {});
      } }, { id: "later", validate: later }
    ] });
    const result = await pending;
    expect(result.issues[0]?.code).toBe("operation_aborted");
    expect(result.provenance).toEqual([]);
    expect(later).not.toHaveBeenCalled();
  });

  it("never publishes a typed output after the output validator cancels", async () => {
    const controller = new AbortController();
    const result = await runValidatedConfigPipeline({ context: undefined, signal: controller.signal,
      loaders: [{ descriptor, load: () => ({ value: {} }) }],
      outputValidator: { id: "output", validate: () => { controller.abort(); return { ok: true, value: 42, issues: [] }; } }
    });
    expect(result.ok).toBe(false);
    expect(Object.hasOwn(result, "value")).toBe(false);
  });

  it.each([false, true])("removes abort listeners after completion (failure: %s)", async failure => {
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const result = await loadConfigSources({ context: undefined, signal: controller.signal, loaders: [{ descriptor,
      load() { if (failure) throw new Error("failure"); return { value: {} }; }
    }] });
    expect(result.sources).toHaveLength(1);
    expect(add).toHaveBeenCalledTimes(1); expect(remove).toHaveBeenCalledTimes(1);
    controller.abort();
    expect(result.issues.some(issue => issue.code === "operation_aborted")).toBe(false);
  });
});
