import { afterEach, describe, expect, it, vi } from "vitest";
import { runConfigPipeline, type ConfigOperationError } from "@0disoft/universal-config-engine-core";
import { createConfigReloader } from "../src/index.js";

const load = () => runConfigPipeline({ context: undefined, loaders: [] });
afterEach(() => { vi.useRealTimers(); });

describe("reload operation deadlines", () => {
  it("times out at the default boundary and never overlaps an uncooperative load", async () => {
    vi.useFakeTimers();
    const observed: ConfigOperationError[] = [];
    let signal: { readonly aborted: boolean } | undefined;
    let reject!: (error: Error) => void;
    const callback = vi.fn(options => { signal = options?.signal;
      return new Promise<Awaited<ReturnType<typeof load>>>((_resolve, fail) => { reject = fail; }); });
    const reloader = createConfigReloader({ load: callback, onError: error => { observed.push(error); } });
    const active = reloader.refresh(), queued = reloader.refresh();
    let settled = false; void active.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await active).toMatchObject({ ok: false, reason: "load_timeout" });
    expect(await queued).toMatchObject({ ok: false, reason: "load_timeout" });
    expect(await reloader.refresh()).toMatchObject({ reason: "load_timeout" });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(signal?.aborted).toBe(true);
    expect(observed[0]?.code).toBe("reload_load_timeout");
    expect(vi.getTimerCount()).toBe(0);
    reject(new Error("late uncooperative rejection")); await Promise.resolve();
  });

  it("aborts and disables a stalled observer while keeping refresh operational", async () => {
    vi.useFakeTimers();
    const observed: ConfigOperationError[] = [];
    let signal: { readonly aborted: boolean } | undefined;
    const observer = vi.fn((_event, options) => { signal = options?.signal; return new Promise<void>(() => {}); });
    const reloader = createConfigReloader({ load, onChange: observer, observerTimeoutMs: 10,
      onError: error => { observed.push(error); } });
    try {
      await reloader.refresh(); await reloader.refresh();
      await vi.advanceTimersByTimeAsync(10);
      expect(signal?.aborted).toBe(true);
      expect(observed.map(error => error.code)).toEqual(["reload_observer_timeout"]);
      expect((await reloader.refresh()).ok).toBe(true);
      expect(observer).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally { reloader.close(); }
  });

  it("retains the last good snapshot after a later load times out", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const reloader = createConfigReloader({ load: () => ++calls === 1 ? load() : new Promise(() => {}), loadTimeoutMs: 10 });
    const good = await reloader.refresh();
    expect(good.ok).toBe(true);
    const pending = reloader.refresh(); await vi.advanceTimersByTimeAsync(10);
    expect(await pending).toMatchObject({ ok: false, revision: 1, reason: "load_timeout" });
    expect(reloader.getSnapshot()).toBe(good.ok ? good.snapshot : undefined);
  });

  it("close clears a pending deadline without reporting a timeout", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const reloader = createConfigReloader({ load: () => new Promise(() => {}), onError });
    const pending = reloader.refresh(); reloader.close();
    expect(await pending).toMatchObject({ reason: "closed" });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(onError).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([0, -1, 1.5, NaN, Infinity, 2_147_483_648])("rejects invalid timer duration %s", value => {
    expect(() => createConfigReloader({ load, loadTimeoutMs: value })).toThrow(RangeError);
    expect(() => createConfigReloader({ load, observerTimeoutMs: value })).toThrow(RangeError);
  });
});
