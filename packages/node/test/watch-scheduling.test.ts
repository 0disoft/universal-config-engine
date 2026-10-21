import { afterEach, describe, expect, it, vi } from "vitest";
import { runConfigPipeline } from "@0disoft/universal-config-engine-core";
import { watchConfigFiles } from "../src/watch.js";

const fs = vi.hoisted(() => ({ callbacks: [] as ((_event: string, filename: string | null) => void)[],
  close: vi.fn() }));
vi.mock("node:fs", () => ({ watch: vi.fn((_directory, _options, callback) => {
  fs.callbacks.push(callback);
  return { close: fs.close, on: vi.fn() };
}) }));
vi.mock("node:fs/promises", async () => {
  const { resolve } = await import("node:path");
  return { realpath: vi.fn(async (path: string) => resolve(path)),
    stat: vi.fn(async () => ({ isDirectory: () => true })) };
});

afterEach(() => { vi.useRealTimers(); fs.callbacks.length = 0; vi.clearAllMocks(); });

describe("bounded watch scheduling", () => {
  it("refreshes during continuous changes instead of waiting indefinitely for silence", async () => {
    vi.useFakeTimers();
    const load = vi.fn(() => runConfigPipeline({ context: undefined, loaders: [] }));
    const watched = await watchConfigFiles({ workspacePath: "/workspace", paths: ["config.json"], debounceMs: 250, load });
    expect(watched.ok).toBe(true); if (!watched.ok) return;
    try {
      expect(load).toHaveBeenCalledTimes(1);
      for (let index = 0; index < 20; index++) {
        for (const callback of fs.callbacks) callback("change", "config.json");
        await vi.advanceTimersByTimeAsync(100);
        if (index === 9) expect(load).toHaveBeenCalledTimes(2);
      }
      expect(load).toHaveBeenCalledTimes(3);
      expect(vi.getTimerCount()).toBe(0);
    } finally { watched.watcher.close(); }
  });

  it("still debounces short bursts, ignores unrelated names and cancels both timers on close", async () => {
    vi.useFakeTimers();
    const load = vi.fn(() => runConfigPipeline({ context: undefined, loaders: [] }));
    const watched = await watchConfigFiles({ workspacePath: "/workspace", paths: ["config.json"], debounceMs: 25, load });
    expect(watched.ok).toBe(true); if (!watched.ok) return;
    try {
      for (const callback of fs.callbacks) callback("change", "unrelated.json");
      expect(vi.getTimerCount()).toBe(0);
      for (let index = 0; index < 3; index++) {
        for (const callback of fs.callbacks) callback("change", "config.json");
        await vi.advanceTimersByTimeAsync(10);
      }
      expect(load).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(15);
      expect(load).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
      for (const callback of fs.callbacks) callback("rename", null);
      expect(vi.getTimerCount()).toBe(2);
      watched.watcher.close();
      expect(fs.close).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(2000);
      expect(load).toHaveBeenCalledTimes(2);
    } finally { watched.watcher.close(); }
  });
});
