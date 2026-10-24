import { relative, resolve, sep } from "node:path";
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
  it.each([127, 128])("bounds ancestor directory handles at depth %s before installing watches", async depth => {
    const runtime = fixture();
    const read = vi.fn(load);
    const watched = await watchConfigFiles({ workspacePath: "/workspace",
      paths: [`${Array.from({ length: depth }, () => "a").join("/")}/config.json`], load: read }, runtime.dependencies);
    if (depth === 128) {
      expect(watched).toEqual({ ok: false, code: "watch_setup_failed" });
      expect(runtime.dependencies.watch).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
    } else {
      expect(watched.ok).toBe(true); if (!watched.ok) return;
      try { expect(runtime.dependencies.watch).toHaveBeenCalledTimes(128); }
      finally { watched.watcher.close(); }
      expect(runtime.close).toHaveBeenCalledTimes(128);
    }
  });

  it.each([190, 191])("bounds resolution work even when directory aliases share a handle at depth %s", async depth => {
    const runtime = fixture();
    const root = resolve("/workspace");
    runtime.dependencies.realpath.mockImplementation(async path => path.endsWith("config.json") ? resolve(root, "config.json") : root);
    const watched = await watchConfigFiles({ workspacePath: root,
      paths: [`${"a/".repeat(depth)}config.json`], load }, runtime.dependencies);
    if (depth === 191) {
      expect(watched).toEqual({ ok: false, code: "watch_setup_failed" });
      expect(runtime.dependencies.realpath).toHaveBeenCalledTimes(193); // Workspace + 192 selections.
      expect(runtime.dependencies.watch).not.toHaveBeenCalled();
    } else {
      expect(watched.ok).toBe(true); if (!watched.ok) return;
      try { expect(runtime.dependencies.watch).toHaveBeenCalledTimes(1); }
      finally { watched.watcher.close(); }
    }
  });

  it("rejects an intermediate directory link leaving the workspace without calling load", async () => {
    const runtime = fixture();
    const root = resolve("/workspace"), current = resolve(root, "current");
    let target = resolve(root, "first");
    runtime.dependencies.realpath.mockImplementation(async path => path === current || path.startsWith(`${current}${sep}`)
      ? resolve(target, relative(current, path)) : resolve(path));
    const read = vi.fn(load);
    const watched = await watchConfigFiles({ workspacePath: root, paths: ["current/config.json"], load: read }, runtime.dependencies);
    expect(watched.ok).toBe(true); if (!watched.ok) return;
    try {
      const previous = watched.watcher.getSnapshot();
      target = resolve("/outside");
      expect(await watched.watcher.refresh()).toMatchObject({ ok: false, reason: "load_failed" });
      expect(read).toHaveBeenCalledTimes(1);
      expect(watched.watcher.getSnapshot()).toBe(previous);
      target = resolve(root, "second");
      expect(await watched.watcher.refresh()).toMatchObject({ ok: true });
      expect(read).toHaveBeenCalledTimes(2);
    } finally { watched.watcher.close(); }
  });

  it("canonicalizes shared parents once per pass and rechecks them on every refresh", async () => {
    const runtime = fixture();
    const watched = await watchConfigFiles({ workspacePath: "/workspace",
      paths: Array.from({ length: 64 }, (_, index) => `${index}.json`), load }, runtime.dependencies);
    expect(watched.ok).toBe(true); if (!watched.ok) return;
    try {
      for (let index = 0; index < 2; index += 1) {
        runtime.dependencies.realpath.mockClear();
        await watched.watcher.refresh();
        expect(runtime.dependencies.realpath).toHaveBeenCalledTimes(65);
      }
    } finally { watched.watcher.close(); }
  });

  it("releases watcher handles when a later refresh times out", async () => {
    vi.useFakeTimers();
    const runtime = fixture();
    let calls = 0;
    try {
      const watched = await watchConfigFiles({ workspacePath: "/workspace", paths: ["config.json"], loadTimeoutMs: 10,
        load: () => ++calls === 1 ? load() : new Promise(() => {}) }, runtime.dependencies);
      expect(watched.ok).toBe(true); if (!watched.ok) return;
      const pending = watched.watcher.refresh();
      await vi.advanceTimersByTimeAsync(10);
      expect(await pending).toMatchObject({ reason: "load_timeout" });
      expect(runtime.close).toHaveBeenCalledTimes(1);
      expect(runtime.jobs.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it("continues closing other handles and the reloader when one disposer throws", async () => {
    const runtime = fixture();
    const firstClose = vi.fn().mockImplementationOnce(() => { throw new Error("close failed"); });
    const otherClose = vi.fn();
    runtime.dependencies.watch.mockImplementationOnce(() => ({ close: firstClose, on() {} }))
      .mockImplementationOnce(() => ({ close: otherClose, on() {} }));
    let signal: { readonly aborted: boolean } | undefined;
    const watched = await watchConfigFiles({ workspacePath: "/workspace", paths: ["a/config.json", "b/config.json"],
      load: options => { signal = options?.signal; return load(); } }, runtime.dependencies);
    expect(watched.ok).toBe(true); if (!watched.ok) return;
    expect(() => watched.watcher.close()).not.toThrow();
    expect(firstClose).toHaveBeenCalledTimes(1);
    expect(otherClose).toHaveBeenCalledTimes(1);
    expect(signal?.aborted).toBe(true);
    expect(await watched.watcher.refresh()).toMatchObject({ ok: false, reason: "closed" });
    watched.watcher.close();
    expect(firstClose).toHaveBeenCalledTimes(2);
    expect(otherClose).toHaveBeenCalledTimes(1);
  });

  it("releases remaining resources when a timer cancellation throws and retries only failures", async () => {
    const runtime = fixture();
    const cancelDebounce = vi.fn().mockImplementationOnce(() => { throw new Error("cancel failed"); });
    const cancelMaxWait = vi.fn();
    runtime.dependencies.schedule = vi.fn().mockReturnValueOnce(cancelDebounce).mockReturnValueOnce(cancelMaxWait);
    const watched = await watchConfigFiles({ workspacePath: "/workspace", paths: ["config.json"], load }, runtime.dependencies);
    expect(watched.ok).toBe(true); if (!watched.ok) return;
    runtime.emit();
    expect(() => watched.watcher.close()).not.toThrow();
    expect(cancelMaxWait).toHaveBeenCalledTimes(1);
    expect(runtime.close).toHaveBeenCalledTimes(1);
    watched.watcher.close();
    expect(cancelDebounce).toHaveBeenCalledTimes(2);
    expect(cancelMaxWait).toHaveBeenCalledTimes(1);
    expect(runtime.close).toHaveBeenCalledTimes(1);
  });

  it("contains scheduling exceptions and cleans already created resources", async () => {
    const runtime = fixture();
    const cancel = vi.fn();
    runtime.dependencies.schedule = vi.fn().mockReturnValueOnce(cancel)
      .mockImplementationOnce(() => { throw new Error("schedule failed"); });
    const watched = await watchConfigFiles({ workspacePath: "/workspace", paths: ["config.json"], load }, runtime.dependencies);
    expect(watched.ok).toBe(true); if (!watched.ok) return;
    expect(() => runtime.emit()).not.toThrow();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(runtime.close).toHaveBeenCalledTimes(1);
    expect(await watched.watcher.refresh()).toMatchObject({ ok: false, reason: "closed" });
  });

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
