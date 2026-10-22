import { describe, expect, it } from "vitest";
import { getConfigValueAtPath, runConfigPipeline, type ConfigValue } from "@0disoft/universal-config-engine-core";
import { createConfigReloader, type ConfigReloadEvent } from "../src/index.js";

const pipeline = (port = 80) => runConfigPipeline({ context: undefined, loaders: [{
  descriptor: { id: "settings", kind: "object", displayName: "settings", priority: 0 }, load: () => ({ value: { port } })
}] });

describe("serialized config reload", () => {
  it("settles active and queued refreshes on cancellation even when load ignores it", async () => {
    const controller = new AbortController();
    let signal: { readonly aborted: boolean } | undefined;
    let reject!: (error: Error) => void;
    const events: ConfigReloadEvent[] = [];
    const reloader = createConfigReloader({ signal: controller.signal, load: options => {
      signal = options?.signal;
      return new Promise((_resolve, fail) => { reject = fail; });
    }, onChange: event => { events.push(event); } });
    const active = reloader.refresh(); const queued = reloader.refresh();
    controller.abort();
    expect(await active).toMatchObject({ ok: false, reason: "closed" });
    expect(await queued).toMatchObject({ ok: false, reason: "closed" });
    expect(signal?.aborted).toBe(true);
    reject(new Error("late callback rejection")); await Promise.resolve();
    expect(reloader.getSnapshot()).toBeUndefined(); expect(events).toEqual([]);
    reloader.close();
  });

  it("does not call load with an already aborted lifetime", async () => {
    const controller = new AbortController(); controller.abort();
    let calls = 0;
    const reloader = createConfigReloader({ signal: controller.signal, load: () => { calls++; return pipeline(); } });
    expect(await reloader.refresh()).toMatchObject({ ok: false, reason: "closed" });
    expect(calls).toBe(0);
  });

  it.each([
    { added: false, opaque: { a: 1 } }, { added: true, opaque: { a: 1 } },
    { added: false, opaque: { inner: { a: 1 } } }, { added: true, opaque: { inner: { a: 1 } } }
  ])("omits ambiguous public counts for secret object structure changes ($added, $opaque)", async ({ added, opaque }) => {
    const events: ConfigReloadEvent[] = [];
    let present = !added;
    const reloader = createConfigReloader({ load: () => runConfigPipeline({ context: undefined,
      reportOptions: { secretPaths: [["opaque"]] }, loaders: [{
        descriptor: { id: "settings", kind: "object", priority: 0, displayName: "settings" },
        load: () => ({ value: { port: 80, ...(present ? { opaque } : {}) } })
      }] }), onChange: event => { events.push(event); } });
    try {
      expect(await reloader.refresh()).toMatchObject({ ok: true, revision: 1 });
      present = added;
      expect(await reloader.refresh()).toMatchObject({ ok: true, revision: 2 });
      expect(events[1]).toEqual({ status: "updated", revision: 2 });
      expect(reloader.getSnapshot()?.result.config).toEqual({ port: 80, ...(added ? { opaque } : {}) });
    } finally { reloader.close(); }
  });

  it("keeps public sibling container counts when names share a string prefix", async () => {
    const events: ConfigReloadEvent[] = [];
    let removed = false;
    const reloader = createConfigReloader({ load: () => runConfigPipeline({ context: undefined,
      reportOptions: { secretPaths: [["opaque"]] }, loaders: [{
        descriptor: { id: "settings", kind: "object", priority: 0, displayName: "settings" },
        load: () => ({ value: { opaque: { a: 1 }, ...(removed ? {} : { opaque2: { x: 1 } }) } })
      }] }), onChange: event => { events.push(event); } });
    try {
      await reloader.refresh(); removed = true; await reloader.refresh();
      expect(events[1]).toMatchObject({ status: "updated", changedPathCount: 2 });
    } finally { reloader.close(); }
  });

  it("publishes an owned frozen snapshot at an explicitly increased config depth", async () => {
    const depth = 2500;
    let value: ConfigValue = { leaf: 1 };
    for (let index = 0; index < depth; index++) value = { next: value };
    const original = await runConfigPipeline({ context: undefined, limits: {
      maxDepth: 3000, maxPathLength: 3000, maxKeyCount: 4000, maxReportBytes: 1024 * 1024
    }, loaders: [{ descriptor: { id: "deep", kind: "object", priority: 0, displayName: "deep" },
      load: () => ({ value }) }] });
    expect(original.result.ok).toBe(true);
    const reloader = createConfigReloader({ load: async () => original });
    try {
      expect(await reloader.refresh()).toMatchObject({ ok: true, revision: 1 });
      const path = Array.from({ length: depth }, () => "next");
      const snapshot = reloader.getSnapshot()!;
      const frozenLeaf = getConfigValueAtPath(snapshot.result.config, path);
      const originalLeaf = getConfigValueAtPath(original.result.config, path) as Record<string, ConfigValue>;
      originalLeaf.leaf = 2;
      expect(frozenLeaf).toEqual({ leaf: 1 });
      expect(Object.isFrozen(frozenLeaf)).toBe(true);
      expect(Object.isFrozen(snapshot.result.config)).toBe(true);
      expect(snapshot.result.config).not.toBe(original.result.config);
    } finally { reloader.close(); }
  });

  it.each(["path", "name", "source"])("retains report-only %s redaction on either side of a reload", async policy => {
    const events: ConfigReloadEvent[] = [];
    let step = 0;
    const reloader = createConfigReloader({ load: () => runConfigPipeline({ context: undefined, loaders: [
      { descriptor: { id: "sensitive", kind: "object", displayName: "settings", priority: 0 }, load: () => ({ value: { pin: step } }) },
      { descriptor: { id: "public", kind: "object", displayName: "public", priority: 1 }, load: () => ({ value: { port: 80 + step } }) }
    ], ...(step === 1 ? {} : { reportOptions: policy === "path" ? { secretPaths: [["pin"]] }
      : policy === "name" ? { secretNamePatterns: ["pin"] } : { secretSourceIds: ["sensitive"] } }) }),
      onChange: event => { events.push(event); } });
    try {
      await reloader.refresh();
      for (step = 1; step <= 2; step++) {
        expect(await reloader.refresh()).toMatchObject({ ok: true });
        // pin and port both change, but only port may contribute to this count.
        expect(events.at(-1)).toMatchObject({ status: "updated", changedPathCount: 1 });
      }
    } finally { reloader.close(); }
  });

  it("queues a refresh requested synchronously from inside the initial loader", async () => {
    const first = await pipeline(80);
    const second = await pipeline(443);
    let calls = 0;
    let release!: (value: typeof first) => void;
    let nested: ReturnType<ReturnType<typeof createConfigReloader>["refresh"]> | undefined;
    const reloader = createConfigReloader({ load: () => {
      calls += 1;
      if (calls !== 1) return Promise.resolve(second);
      nested = reloader.refresh();
      return new Promise(resolve => { release = resolve; });
    } });
    const active = reloader.refresh();
    try {
      expect(calls).toBe(1);
      expect(reloader.refresh()).toBe(nested);
      release(first);
      expect(await active).toMatchObject({ ok: true, revision: 1 });
      expect(await nested).toMatchObject({ ok: true, revision: 2 });
      expect(calls).toBe(2);
      expect(reloader.getSnapshot()?.result.config).toEqual({ port: 443 });
    } finally {
      release(first);
      await Promise.all([active, nested]);
      reloader.close();
    }
  });

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
