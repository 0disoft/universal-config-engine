import { describe, expect, it } from "vitest";
import { runConfigPipeline } from "@0disoft/universal-config-engine-core";
import { createConfigReloader, type ConfigReloadEvent } from "../src/index.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(complete => { resolve = complete; });
  return { promise, resolve };
}
const load = () => runConfigPipeline({ context: undefined, loaders: [] });

describe("bounded reload notifications", () => {
  it("serializes observers and retains only the latest pending state", async () => {
    const gate = deferred(), latest = deferred();
    const applied: ConfigReloadEvent[] = [];
    let active = 0, maximum = 0;
    const reloader = createConfigReloader({ load, async onChange(event) {
      active++; maximum = Math.max(maximum, active);
      if (event.revision === 1) await gate.promise;
      applied.push(event); active--;
      if (event.revision === 6) latest.resolve();
    } });
    try {
      for (let revision = 1; revision <= 6; revision++) {
        expect(await reloader.refresh()).toMatchObject({ ok: true, revision });
      }
      expect(active).toBe(1); expect(applied).toEqual([]);
      gate.resolve(); await latest.promise;
      expect(maximum).toBe(1);
      expect(applied.map(event => event.revision)).toEqual([1, 6]);
      expect(applied[1]).not.toHaveProperty("changedPathCount");
    } finally { gate.resolve(); reloader.close(); }
  });

  it("lets an observer await another refresh without deadlocking", async () => {
    const second = deferred();
    const reloader = createConfigReloader({ load, async onChange(event) {
      if (event.revision === 1) expect(await reloader.refresh()).toMatchObject({ ok: true, revision: 2 });
      else second.resolve();
    } });
    try { await reloader.refresh(); await second.promise; }
    finally { reloader.close(); }
  });

  it("continues notification after an asynchronous observer rejects", async () => {
    const gate = deferred(), second = deferred();
    const reloader = createConfigReloader({ load, async onChange(event) {
      if (event.revision === 1) { await gate.promise; throw new Error("observer failed"); }
      second.resolve();
    } });
    try {
      await reloader.refresh(); await reloader.refresh();
      gate.resolve(); await second.promise;
      expect(reloader.getSnapshot()).toBeDefined();
    } finally { gate.resolve(); reloader.close(); }
  });

  it("aborts active observers and discards pending ones on close", async () => {
    const finished = deferred();
    let calls = 0, writes = 0, cleaned = 0;
    const reloader = createConfigReloader({ load, async onChange(_event, options) {
      calls++;
      const signal = options!.signal!;
      try {
        await new Promise<void>(resolve => { signal.addEventListener("abort", resolve, { once: true }); });
        if (!signal.aborted) writes++;
      } finally { cleaned++; finished.resolve(); }
    } });
    await reloader.refresh(); await reloader.refresh();
    reloader.close(); await finished.promise;
    expect(calls).toBe(1); expect(writes).toBe(0); expect(cleaned).toBe(1);
  });
});
