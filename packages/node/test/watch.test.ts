import { mkdtemp, rename, rm, writeFile, mkdir, symlink, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getConfigValueAtPath, runConfigPipeline } from "@0disoft/universal-config-engine-core";
import { loadJsonFileSource, watchConfigFiles } from "../src/index.js";

async function workspace(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "uce-watch-"));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

describe("disposable bounded file watch", () => {
  it("owns its bounded path selection before asynchronous filesystem work", async () => {
    await workspace(async root => {
      await writeFile(join(root, "config.json"), "{}");
      const paths = ["config.json"];
      const pending = watchConfigFiles({ workspacePath: root, paths, load: () => runConfigPipeline({ context: undefined, loaders: [] }) });
      paths.splice(0, 1, "../outside.json", ...Array.from({ length: 64 }, (_, index) => `${index}.json`));
      const result = await pending;
      try { expect(result.ok).toBe(true); }
      finally { if (result.ok) result.watcher.close(); }
    });
  });

  it("reloads atomic replacements and keeps the last good config after invalid JSON", async () => {
    await workspace(async root => {
      const path = join(root, "config.json");
      await writeFile(path, '{"port":80}');
      let notify: (() => void) | undefined;
      const watched = await watchConfigFiles({ workspacePath: root, paths: ["config.json"], debounceMs: 0,
        load: async () => runConfigPipeline({ context: undefined, loaders: [{
          descriptor: { id: "file", kind: "json-file", displayName: "file", priority: 0 },
          load: async () => loadJsonFileSource({ descriptor: { id: "file", kind: "json-file", displayName: "file", priority: 0 }, filePath: path, allowedRootPath: root })
        }] }), onChange: () => { notify?.(); } });
      expect(watched.ok).toBe(true); if (!watched.ok) return;
      async function until(predicate: () => boolean) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([new Promise<void>(resolve => { notify = () => { if (predicate()) resolve(); }; if (predicate()) resolve(); }),
            new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("watch timeout")), 3000); })]);
        } finally { if (timer !== undefined) clearTimeout(timer); notify = undefined; }
      }
      try {
        expect(watched.watcher.getSnapshot()?.result.config).toEqual({ port: 80 });
        const changed = until(() => JSON.stringify(watched.watcher.getSnapshot()?.result.config) === '{"port":443}');
        await writeFile(join(root, "next.json"), '{"port":443}'); await rename(join(root, "next.json"), path); await changed;
        const good = watched.watcher.getSnapshot();
        await writeFile(path, "not JSON");
        expect(await watched.watcher.refresh()).toMatchObject({ ok: false, reason: "validation_failed" });
        expect(watched.watcher.getSnapshot()).toBe(good);
      } finally { watched.watcher.close(); }
      expect(await watched.watcher.refresh()).toMatchObject({ ok: false, reason: "closed" });
    });
  });

  it("rejects oversize selections and symlink escapes before loading", async () => {
    await workspace(async root => {
      const load = async (): Promise<never> => { throw new Error("must not load"); };
      expect(await watchConfigFiles({ workspacePath: root, paths: new Array(65), load })).toEqual({ ok: false, code: "watch_input_invalid" });
      await mkdir(join(root, "inside")); await writeFile(join(root, "outside.json"), "{}");
      await symlink(join(root, "outside.json"), join(root, "inside/config.json"), "file");
      expect(await watchConfigFiles({ workspacePath: join(root, "inside"), paths: ["config.json"], load }))
        .toEqual({ ok: false, code: "watch_path_outside_workspace" });
    });
  });

  it("follows in-workspace file links and rebinds watches after retargeting", async () => {
    await workspace(async root => {
      await mkdir(join(root, "first")); await mkdir(join(root, "second"));
      const first = join(root, "first/config.json");
      const second = join(root, "second/config.json");
      const link = join(root, "linked.json");
      await writeFile(first, '{"port":80}'); await writeFile(second, '{"port":90}');
      await symlink(first, link, "file");
      let notify: (() => void) | undefined;
      const descriptor = { id: "file", kind: "json-file", priority: 0, displayName: "file" } as const;
      const watched = await watchConfigFiles({ workspacePath: root, paths: ["linked.json"],
        load: () => runConfigPipeline({ context: undefined, loaders: [{ descriptor,
          load: () => loadJsonFileSource({ descriptor, filePath: link, allowedRootPath: root }) }] }),
        onChange: () => { notify?.(); }
      });
      expect(watched.ok).toBe(true); if (!watched.ok) return;
      async function expectReload(update: () => Promise<unknown>, port: number) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const changed = new Promise<void>((resolve, reject) => {
            notify = () => {
              const config = watched.ok ? watched.watcher.getSnapshot()?.result.config : undefined;
              if (config !== undefined && getConfigValueAtPath(config, ["port"]) === port) resolve();
            };
            timer = setTimeout(() => reject(new Error("linked watch timeout")), 3000);
          });
          await update(); await changed;
        } finally { if (timer !== undefined) clearTimeout(timer); notify = undefined; }
      }
      try {
        await expectReload(() => writeFile(first, '{"port":81}'), 81);
        await expectReload(async () => { await unlink(link); await symlink(second, link, "file"); }, 90);
        await expectReload(() => writeFile(second, '{"port":91}'), 91);
      } finally { watched.watcher.close(); }
    });
  });

  it("rejects a link retargeted outside the workspace before invoking the loader", async () => {
    await workspace(async root => {
      const inside = join(root, "inside"); await mkdir(inside);
      const target = join(inside, "config.json");
      const link = join(inside, "linked.json");
      const outside = join(root, "outside.json");
      await writeFile(target, "{}"); await writeFile(outside, "{}"); await symlink(target, link, "file");
      let loads = 0;
      const watched = await watchConfigFiles({ workspacePath: inside, paths: ["linked.json"], load: () => {
        loads += 1; return runConfigPipeline({ context: undefined, loaders: [] });
      } });
      expect(watched.ok).toBe(true); if (!watched.ok) return;
      try {
        const previous = watched.watcher.getSnapshot();
        await unlink(link); await symlink(outside, link, "file");
        expect(await watched.watcher.refresh()).toMatchObject({ ok: false, reason: "load_failed" });
        expect(loads).toBe(1);
        expect(watched.watcher.getSnapshot()).toBe(previous);
      } finally { watched.watcher.close(); }
    });
  });
});
