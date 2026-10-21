import { mkdtemp, rename, rm, writeFile, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runConfigPipeline } from "@0disoft/universal-config-engine-core";
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
});
