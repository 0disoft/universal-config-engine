import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runConfigPipeline } from "@0disoft/universal-config-engine-core";
import { watchConfig, watchConfigFiles, type ConfigWatchDependencies, type WatchConfigFilesResult } from "../src/index.js";
import { runWatchSetup } from "../src/watch-setup.js";

const scenarios = [
  ["explicit", "root"], ["explicit", "stat"], ["explicit", "ancestor"],
  ["automatic", "root"], ["automatic", "stat"]
] as const;

function fixture(mode: string, stage: string, signal?: AbortSignal) {
  let release!: () => void;
  const blocked = new Promise<void>(done => { release = done; });
  const root = resolve("/workspace");
  let calls = 0;
  const dependencies = {
    realpath: vi.fn(async (path: string) => {
      calls++;
      if (stage === "root" && calls === 1 || stage === "ancestor" && calls === 2) await blocked;
      return resolve(path);
    }),
    stat: vi.fn(async () => { if (stage === "stat") await blocked; return { isDirectory: () => true }; }),
    watch: vi.fn(() => ({ close: vi.fn(), on() {} })),
    schedule(callback, delay) { const timer = setTimeout(callback, delay); return () => clearTimeout(timer); }
  } satisfies ConfigWatchDependencies;
  const load = vi.fn(() => runConfigPipeline({ context: undefined, loaders: [] }));
  const options = { workspacePath: root, loadTimeoutMs: 10, ...(signal === undefined ? {} : { signal }) };
  const pending = mode === "automatic" ? watchConfig({ ...options, configPath: "config.json", cwd: root }, dependencies)
    : watchConfigFiles({ ...options, paths: ["config.json"], load }, dependencies);
  let outcome: WatchConfigFilesResult | undefined;
  void pending.then(value => { outcome = value; });
  return { pending, release, dependencies, load, outcome: () => outcome };
}

describe("watch setup I/O lifetime", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("rejects a synchronous parent abort even when metadata immediately resolves", async () => {
    const controller = new AbortController();
    await expect(runWatchSetup({ signal: controller.signal }, () => {
      controller.abort();
      return Promise.resolve("unused");
    })).rejects.toBeInstanceOf(Error);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shares one setup budget across metadata calls instead of restarting it for each await", async () => {
    const pause = () => new Promise<void>(done => { setTimeout(done, 6); });
    const root = resolve("/workspace");
    const watch = vi.fn(() => ({ close() {}, on() {} }));
    const realpath = vi.fn(async (path: string) => { await pause(); return path; });
    const stat = vi.fn(async () => { await pause(); return { isDirectory: () => true }; });
    const pending = watchConfigFiles({ workspacePath: root, paths: ["config.json"], loadTimeoutMs: 10,
      load: () => runConfigPipeline({ context: undefined, loaders: [] }) }, {
      realpath, stat, watch, schedule() { throw new Error("Setup must not schedule watch events."); }
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(await pending).toEqual({ ok: false, code: "watch_setup_failed" });
    // The injected stat already started; the adapter does not pretend to stop OS I/O.
    await vi.advanceTimersByTimeAsync(2);
    expect(realpath).toHaveBeenCalledTimes(1);
    expect(stat).toHaveBeenCalledTimes(1);
    expect(watch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["sync", "async"])("cleans setup timers when %s metadata work throws", async mode => {
    const cause = new Error("UCE_SETUP_PRIVATE");
    await expect(runWatchSetup({}, () => {
      if (mode === "sync") throw cause;
      return Promise.reject(cause);
    })).rejects.toBe(cause);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(scenarios)("bounds %s %s setup without acquiring handles after late completion", async (mode, stage) => {
    const runtime = fixture(mode, stage);
    try {
      await vi.advanceTimersByTimeAsync(10);
      expect(runtime.outcome()).toEqual({ ok: false, code: "watch_setup_failed" });
      expect(vi.getTimerCount()).toBe(0);
      const calls = [runtime.dependencies.realpath.mock.calls.length, runtime.dependencies.stat.mock.calls.length];
      runtime.release();
      await vi.advanceTimersByTimeAsync(0);
      expect([runtime.dependencies.realpath.mock.calls.length, runtime.dependencies.stat.mock.calls.length]).toEqual(calls);
      expect(runtime.dependencies.watch).not.toHaveBeenCalled();
      expect(runtime.load).not.toHaveBeenCalled();
    } finally {
      runtime.release();
      const result = await runtime.pending;
      if (result.ok) result.watcher.close();
    }
  });

  it.each(scenarios)("cancels %s %s setup before the blocked I/O completes", async (mode, stage) => {
    const controller = new AbortController();
    const removed = vi.spyOn(controller.signal, "removeEventListener");
    const runtime = fixture(mode, stage, controller.signal);
    try {
      await vi.advanceTimersByTimeAsync(0);
      controller.abort();
      await vi.advanceTimersByTimeAsync(0);
      expect(runtime.outcome()).toEqual({ ok: false, code: "watch_setup_failed" });
      expect(vi.getTimerCount()).toBe(0);
      expect(removed).toHaveBeenCalledWith("abort", expect.any(Function));
      expect(runtime.dependencies.watch).not.toHaveBeenCalled();
    } finally {
      runtime.release();
      const result = await runtime.pending;
      if (result.ok) result.watcher.close();
    }
  });
});
