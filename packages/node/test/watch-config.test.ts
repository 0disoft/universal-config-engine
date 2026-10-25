import { mkdtemp, mkdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getConfigValueAtPath } from "@0disoft/universal-config-engine-core";
import { watchConfig, type ConfigWatchDependencies, type WatchConfigInput } from "../src/index.js";

async function workspace(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "uce-auto-watch-"));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
const file = (path: string, id = "settings", priority = 0) => ({ id, kind: "json-file", path, priority });
const json = (path: string, value: unknown) => writeFile(path, JSON.stringify(value));

function injected() {
  const canonicalize = vi.fn((path: string) => realpath(path));
  const handles = new Map<string, { callback: (event: string, name: string | null) => void; close: ReturnType<typeof vi.fn> }>();
  const schedule = vi.fn((callback: () => void, delay: number) => {
    const timer = setTimeout(callback, delay); return () => clearTimeout(timer);
  });
  const dependencies: ConfigWatchDependencies = { realpath: canonicalize, stat, schedule,
    watch(directory, _options, callback) {
      const close = vi.fn(() => { handles.delete(directory); });
      handles.set(directory, { callback, close });
      return { close, on() {} };
    }
  };
  return { handles, dependencies, schedule, canonicalize, emit(path: string) { handles.get(dirname(path))?.callback("change", basename(path)); } };
}

async function start(root: string, options: Partial<WatchConfigInput> = {}, dependencies?: ConfigWatchDependencies) {
  const watched = await watchConfig({ workspacePath: root, configPath: "uce.json", cwd: root, debounceMs: 0, ...options }, dependencies);
  expect(watched.ok).toBe(true);
  if (!watched.ok) throw new Error("Watch setup failed.");
  return watched;
}

describe("automatic declaration graph watching", () => {
  it("rechecks unchanged dependencies once per refresh instead of once per discovery callback", async () => {
    await workspace(async root => {
      await json(join(root, "uce.json"), { sources: [file("a.json", "a"), file("b.json", "b", 1)] });
      await json(join(root, "a.json"), { port: 1 }); await json(join(root, "b.json"), { port: 2 });
      const runtime = injected();
      const watched = await start(root, {}, runtime.dependencies);
      try {
        runtime.canonicalize.mockClear();
        expect(await watched.watcher.refresh()).toMatchObject({ ok: true });
        expect(runtime.canonicalize).toHaveBeenCalledTimes(4); // Shared parent + declaration + two files.
      } finally { watched.watcher.close(); }
    });
  });

  it("resolves a workspace alias once and keeps the canonical workspace boundary", async () => {
    await workspace(async root => {
      await mkdir(join(root, "actual"));
      await json(join(root, "actual/uce.json"), { sources: [] });
      await symlink(join(root, "actual"), join(root, "alias"), "junction");
      const watched = await start(join(root, "alias"));
      try { expect(watched.initial.ok).toBe(true); }
      finally { watched.watcher.close(); }
    });
  });

  it("natively follows inherited declarations, source changes and new dependency lists", async () => {
    await workspace(async root => {
      await json(join(root, "uce.json"), { sources: [], extends: ["base.json"] });
      await json(join(root, "base.json"), { sources: [file("settings.json")] });
      await json(join(root, "settings.json"), { port: 1000 });
      await mkdir(join(root, "nested"));
      await json(join(root, "nested/next.json"), { port: 2000 });
      const watched = await start(root);
      const port = () => getConfigValueAtPath(watched.watcher.getSnapshot()?.result.config ?? {}, ["port"]);
      try {
        expect(port()).toBe(1000);
        await json(join(root, "settings.json"), { port: 1500 });
        await vi.waitFor(() => expect(port()).toBe(1500), { timeout: 3000 });
        await json(join(root, "base.json"), { sources: [file("nested/next.json")] });
        await vi.waitFor(() => expect(port()).toBe(2000), { timeout: 3000 });
        await json(join(root, "nested/next.json"), { port: 3000 });
        await vi.waitFor(() => expect(port()).toBe(3000), { timeout: 3000 });
      } finally { watched.watcher.close(); }
    });
  });

  it("retains good dependencies after failure, watches repair files and drops obsolete directories after success", async () => {
    await workspace(async root => {
      await mkdir(join(root, "old")); await mkdir(join(root, "next"));
      await json(join(root, "uce.json"), { sources: [file("old/value.json")] });
      await json(join(root, "old/value.json"), { port: 1 });
      await writeFile(join(root, "next/value.json"), "invalid JSON");
      const runtime = injected(), onChange = vi.fn();
      const watched = await start(root, { onChange }, runtime.dependencies);
      try {
        const previous = watched.watcher.getSnapshot();
        await json(join(root, "uce.json"), { sources: [file("next/value.json")] });
        runtime.emit(join(root, "uce.json"));
        await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ status: "rejected" }), expect.anything()));
        expect(watched.watcher.getSnapshot()).toBe(previous);
        expect(runtime.handles.has(join(root, "old"))).toBe(true);
        expect(runtime.handles.has(join(root, "next"))).toBe(true);
        await json(join(root, "next/value.json"), { port: 2 });
        runtime.emit(join(root, "next/value.json"));
        await vi.waitFor(() => expect(getConfigValueAtPath(watched.watcher.getSnapshot()?.result.config ?? {}, ["port"])).toBe(2));
        expect(runtime.handles.has(join(root, "old"))).toBe(false);
        runtime.schedule.mockClear();
        runtime.emit(join(root, "old/value.json"));
        expect(runtime.schedule).not.toHaveBeenCalled();
      } finally { watched.watcher.close(); }
      expect(runtime.handles.size).toBe(0);
    });
  });

  it("recovers when a missing inherited declaration and its directory are created", async () => {
    await workspace(async root => {
      await json(join(root, "uce.json"), { sources: [], extends: ["missing/base.json"] });
      const runtime = injected();
      const watched = await start(root, {}, runtime.dependencies);
      try {
        expect(watched.initial.ok).toBe(false);
        expect(watched.watcher.getSnapshot()).toBeUndefined();
        await mkdir(join(root, "missing"));
        await json(join(root, "missing/base.json"), { sources: [file("value.json")] });
        await json(join(root, "missing/value.json"), { port: 3 });
        runtime.emit(join(root, "missing"));
        await vi.waitFor(() => expect(getConfigValueAtPath(watched.watcher.getSnapshot()?.result.config ?? {}, ["port"])).toBe(3));
      } finally { watched.watcher.close(); }
    });
  });

  it("tracks only selected profile file sources and does not reload discarded sources", async () => {
    await workspace(async root => {
      await json(join(root, "uce.json"), { sources: [], profiles: {
        production: { sources: [file("prod.json")] }, other: { sources: [file("other.json")] }
      } });
      await json(join(root, "prod.json"), { port: 4 });
      const runtime = injected(), onDependencies = vi.fn();
      const watched = await start(root, { profile: "production", onDependencies }, runtime.dependencies);
      try {
        expect(getConfigValueAtPath(watched.watcher.getSnapshot()?.result.config ?? {}, ["port"])).toBe(4);
        expect(onDependencies.mock.calls.flat(2)).not.toContain(join(root, "other.json"));
        runtime.schedule.mockClear(); runtime.emit(join(root, "other.json"));
        expect(runtime.schedule).not.toHaveBeenCalled();
      } finally { watched.watcher.close(); }
    });
  });

  it("watches only safe ancestors of a new escaping symlink and recovers after repair", async () => {
    await workspace(async root => {
      await mkdir(join(root, "inside"));
      const inside = join(root, "inside");
      await json(join(inside, "uce.json"), { sources: [file("value.json")] });
      await json(join(root, "outside.json"), { port: 99 });
      await symlink(join(root, "outside.json"), join(inside, "value.json"), "file");
      const runtime = injected();
      const watched = await start(inside, {}, runtime.dependencies);
      try {
        expect(watched.initial.ok).toBe(false);
        expect([...runtime.handles.keys()]).toEqual([inside]);
        // Replace the link itself; its parent subscription must already exist.
        await rm(join(inside, "value.json"));
        await json(join(inside, "value.json"), { port: 5 });
        runtime.emit(join(inside, "value.json"));
        await vi.waitFor(() => expect(getConfigValueAtPath(watched.watcher.getSnapshot()?.result.config ?? {}, ["port"])).toBe(5));
      } finally { watched.watcher.close(); }
    });
  });

  it("bounds discovered paths before file I/O and can recover through the declaration", async () => {
    await workspace(async root => {
      await json(join(root, "uce.json"), { limits: { maxSources: 160 },
        sources: Array.from({ length: 160 }, (_, i) => file(`missing-${i}.json`, `file-${i}`)) });
      const runtime = injected();
      const watched = await start(root, {}, runtime.dependencies);
      try {
        expect(watched.initial.ok).toBe(false);
        expect(runtime.handles.size).toBe(1);
        await json(join(root, "uce.json"), { sources: [] });
        runtime.emit(join(root, "uce.json"));
        await vi.waitFor(() => expect(watched.watcher.getSnapshot()?.result.ok).toBe(true));
      } finally { watched.watcher.close(); }
    });
  });

  it("closes subscriptions when cancellation interrupts initial dependency discovery", async () => {
    await workspace(async root => {
      await json(join(root, "uce.json"), { sources: [] });
      const runtime = injected(), controller = new AbortController();
      const watched = await watchConfig({ cwd: root, configPath: "uce.json", workspacePath: root, signal: controller.signal,
        onDependencies() { controller.abort(); return new Promise<void>(() => {}); }
      }, runtime.dependencies);
      expect(watched).toEqual({ ok: false, code: "watch_setup_failed" });
      expect(runtime.handles.size).toBe(0);
    });
  });
});
