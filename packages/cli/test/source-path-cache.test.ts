import { resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { createSourcePathCanonicalizer, resolveConfigRelativePath } from "../src/pipeline/source-paths.js";

it("shares canonical paths only within one source-loading pass", async () => {
  const lookup = vi.fn(async (path: string) => path);
  const root = resolve("workspace");
  const configPath = resolve(root, "pipeline.json");
  const run = async () => {
    const canonicalize = createSourcePathCanonicalizer(lookup);
    for (let index = 0; index < 64; index += 1) {
      expect(await resolveConfigRelativePath({ configPath, cwd: root, allowedRootPath: root,
        sourceIndex: index, sourceId: String(index), targetPath: `${index}.json` }, canonicalize)).toMatchObject({ ok: true });
    }
  };
  await run();
  expect(lookup).toHaveBeenCalledTimes(66);
  await run();
  expect(lookup).toHaveBeenCalledTimes(132);
});

it("coalesces pending lookups without sharing caches between callers", async () => {
  const lookup = vi.fn(async (path: string) => path);
  const canonicalize = createSourcePathCanonicalizer(lookup);
  const first = canonicalize("file");
  expect(canonicalize("file")).toBe(first);
  expect(await first).toBe("file");
  await createSourcePathCanonicalizer(lookup)("file");
  expect(lookup).toHaveBeenCalledTimes(2);
});
