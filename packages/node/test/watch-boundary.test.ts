import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runConfigPipeline } from "@0disoft/universal-config-engine-core";
import { watchConfigFiles, type ConfigWatchDependencies } from "../src/index.js";

function fixture() {
  let now = 0;
  const jobs = new Map<() => void, { at: number; callback: () => void }>();
  const callbacks: ((event: string, name: string | null) => void)[] = [];
  const close = vi.fn();
  const dependencies = {
    realpath: vi.fn(async (path: string) => resolve(path)), stat: vi.fn(async () => ({ isDirectory: () => true })),
    watch: vi.fn((_directory, _options, callback) => {
      callbacks.push(callback); return { close, on() {} };
    }),
    schedule(callback, delay) { const cancel = () => { jobs.delete(cancel); }; jobs.set(cancel, { at: now + delay, callback }); return cancel; }
  } satisfies ConfigWatchDependencies;
  function advance(ms: number) {
    const target = now + ms;
    for (;;) {
      const next = [...jobs.entries()].filter(([, job]) => job.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (next === undefined) break;
      now = next[1].at; jobs.delete(next[0]); next[1].callback();
    }
    now = target;
  }
  return { dependencies, close, jobs, advance, emit() { for (const callback of callbacks) callback("change", "config.json"); } };
}
const load = () => runConfigPipeline({ context: undefined, loaders: [] });

describe("injected watch scheduling", () => {
  it("flushes exactly at max-wait without global timers and clears work on abort", async () => {
    const runtime = fixture(); const controller = new AbortController();
    let updated: (() => void) | undefined;
    const onChange = () => { updated?.(); };
    const watched = await watchConfigFiles({ workspacePath: "/workspace", paths: ["config.json"],
      debounceMs: 1000, signal: controller.signal, load, onChange }, runtime.dependencies);
    expect(watched.ok).toBe(true); if (!watched.ok) return;
    const next = new Promise<void>(resolve => { updated = resolve; });
    runtime.emit(); runtime.advance(999);
    expect(watched.watcher.getSnapshot()).toBeDefined();
    expect(runtime.jobs.size).toBe(2);
    runtime.advance(1); await next;
    expect(runtime.jobs.size).toBe(0);
    runtime.advance(1); expect(runtime.jobs.size).toBe(0);
    runtime.emit(); controller.abort();
    expect(runtime.jobs.size).toBe(0); expect(runtime.close).toHaveBeenCalledTimes(1);
    expect(await watched.watcher.refresh()).toMatchObject({ ok: false, reason: "closed" });
  });

  it.each([-1, 0, 1, 999, 1000, 1001])("validates debounce boundary %s before I/O", async debounceMs => {
    const runtime = fixture();
    const result = await watchConfigFiles({ workspacePath: "/workspace", paths: ["config.json"], debounceMs, load }, runtime.dependencies);
    expect(result.ok).toBe(debounceMs >= 0 && debounceMs <= 1000);
    if (result.ok) result.watcher.close(); else expect(runtime.dependencies.realpath).not.toHaveBeenCalled();
  });

  it("closes setup handles and settles when the initial load is cancelled", async () => {
    const runtime = fixture(); const controller = new AbortController();
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const pending = watchConfigFiles({ workspacePath: "/workspace", paths: ["config.json"], signal: controller.signal,
      load: () => { started(); return new Promise(() => {}); } }, runtime.dependencies);
    await ready; controller.abort();
    expect(await pending).toEqual({ ok: false, code: "watch_setup_failed" });
    expect(runtime.close).toHaveBeenCalledTimes(1);
    expect(runtime.jobs.size).toBe(0);
  });
});
