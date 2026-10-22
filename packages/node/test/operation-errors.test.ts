import { describe, expect, it } from "vitest";
import { runConfigPipeline, type ConfigOperationError } from "@0disoft/universal-config-engine-core";
import { createConfigReloader, loadJsonFileSource } from "../src/index.js";

describe("adapter private operation errors", () => {
  it("preserves read causes without adding private fields to file diagnostics", async () => {
    const cause = new Error("PRIVATE_FILESYSTEM_DETAIL");
    const observed: ConfigOperationError[] = [];
    const source = await loadJsonFileSource({ filePath: "unused", descriptor: {
      id: "json", kind: "json-file", priority: 0, displayName: "json"
    }, onError: failure => { observed.push(failure); }, fileSystem: {
      async open() { throw cause; }, async realpath(path) { return path; }, async stat() { throw new Error(); }
    } });
    expect(observed[0]?.error.cause).toBe(cause);
    expect(observed[0]?.sourceId).toBe("json");
    expect(JSON.stringify(source)).not.toContain("PRIVATE_FILESYSTEM_DETAIL");
  });

  it("observes both loader and observer failures while keeping refresh isolated", async () => {
    const cause = new Error("PRIVATE_RELOAD_DETAIL");
    const observed: ConfigOperationError[] = [];
    const reloader = createConfigReloader({ load: async options => {
      expect(options?.onError).toBeDefined(); throw cause;
    }, onError: error => { observed.push(error); }, onChange() { throw cause; } });
    try {
      const result = await reloader.refresh();
      expect(result).toMatchObject({ ok: false, reason: "load_failed" });
      expect(observed.map(error => error.code)).toEqual(["reload_load_failed", "reload_observer_failed"]);
      expect(observed.every(error => error.error.cause === cause)).toBe(true);
      expect(JSON.stringify(result)).not.toContain("PRIVATE_RELOAD_DETAIL");
    } finally { reloader.close(); }
  });

  it("observes rejected async observers without rejecting successful refreshes", async () => {
    const cause = new Error("async observer failed");
    const observed: ConfigOperationError[] = [];
    const reloader = createConfigReloader({ load: () => runConfigPipeline({ context: undefined, loaders: [] }),
      onChange: async () => { throw cause; }, onError: error => { observed.push(error); } });
    try {
      expect((await reloader.refresh()).ok).toBe(true);
      expect(observed[0]?.error.cause).toBe(cause);
    } finally { reloader.close(); }
  });
});
