import { describe, expect, it } from "vitest";
import { runConfigPipeline } from "@0disoft/universal-config-engine-core";
import { createConfigReloader, type ConfigReloadEvent } from "../src/index.js";

const pipeline = (port = 80) => runConfigPipeline({ context: undefined, loaders: [{
  descriptor: { id: "settings", kind: "object", displayName: "settings", priority: 0 }, load: () => ({ value: { port } })
}] });

describe("serialized config reload", () => {
  it("coalesces bursts into one queued load without overlapping callbacks", async () => {
    const first = await pipeline();
    let release!: (value: typeof first) => void;
    let calls = 0;
    const reloader = createConfigReloader({ load: () => ++calls === 1 ? new Promise(resolve => { release = resolve; }) : pipeline(443) });
    const active = reloader.refresh(); const queued = reloader.refresh();
    expect(reloader.refresh()).toBe(queued); expect(calls).toBe(1);
    release(first);
    expect(await active).toMatchObject({ ok: true, revision: 1 });
    expect(await queued).toMatchObject({ ok: true, revision: 2 }); expect(calls).toBe(2);
    expect(reloader.getSnapshot()?.result.config).toEqual({ port: 443 }); reloader.close();
  });

  it("owns immutable snapshots and retains the last success after all failures", async () => {
    const original = await pipeline();
    const events: ConfigReloadEvent[] = [];
    let mode = 0;
    const reloader = createConfigReloader({ load: async () => {
      if (mode === 1) throw new Error("UCE_RELOAD_PRIVATE");
      if (mode === 2) return { ...original, result: { ...original.result, ok: false } };
      return original;
    }, onChange(event) { events.push(event); return Promise.reject(new Error("observer")); } });
    expect(await reloader.refresh()).toMatchObject({ ok: true, revision: 1 });
    const good = reloader.getSnapshot();
    expect(Object.isFrozen(good?.result.config)).toBe(true);
    (original.result.config as { port: number }).port = 999;
    expect(good?.result.config).toEqual({ port: 80 });
    mode = 1; expect(await reloader.refresh()).toMatchObject({ ok: false, reason: "load_failed" });
    mode = 2; expect(await reloader.refresh()).toMatchObject({ ok: false, reason: "validation_failed" });
    expect(reloader.getSnapshot()).toBe(good); expect(JSON.stringify(events)).not.toContain("UCE_RELOAD_PRIVATE");
    reloader.close(); expect(await reloader.refresh()).toMatchObject({ ok: false, reason: "closed" });
  });

  it("discards an in-flight result and resolves its queue after close", async () => {
    let release!: (value: Awaited<ReturnType<typeof pipeline>>) => void;
    const events: ConfigReloadEvent[] = [];
    const reloader = createConfigReloader({ load: () => new Promise(resolve => { release = resolve; }), onChange: event => { events.push(event); } });
    const active = reloader.refresh(); const queued = reloader.refresh(); reloader.close();
    expect(await queued).toMatchObject({ ok: false, reason: "closed" });
    release(await pipeline()); expect(await active).toMatchObject({ ok: false, reason: "closed" });
    expect(reloader.getSnapshot()).toBeUndefined(); expect(events).toEqual([]);
  });

  it("does not count secret type or source changes as public changes", async () => {
    const events: ConfigReloadEvent[] = [];
    let changed = false;
    const reloader = createConfigReloader({ load: () => runConfigPipeline({ context: undefined, loaders: [{
      descriptor: { id: changed ? "new-source" : "old-source", kind: "object", displayName: "settings", priority: 0 },
      load: () => ({ value: { password: changed ? 123 : "UCE_RELOAD_PRIVATE" } })
    }] }), onChange: event => { events.push(event); } });
    try {
      await reloader.refresh(); changed = true; await reloader.refresh();
      expect(events[1]).toMatchObject({ status: "updated", revision: 2, changedPathCount: 0 });
      expect(JSON.stringify(events)).not.toContain("UCE_RELOAD_PRIVATE");
    } finally { reloader.close(); }
  });
});
