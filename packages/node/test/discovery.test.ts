import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_PIPELINE_FILENAMES, discoverPipelineDeclaration } from "../src/index.js";

async function workspace(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "uce-discovery-"));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

describe("bounded pipeline discovery", () => {
  it("selects the nearest declaration and ordered filename without parsing it", async () => {
    await workspace(async root => {
      await mkdir(join(root, "app"));
      await writeFile(join(root, "uce.json"), "{}");
      await writeFile(join(root, "app/.uce.json"), "not JSON and never executed");
      await writeFile(join(root, "app/uce.config.json"), "{}");
      const found = await discoverPipelineDeclaration({ workspacePath: root, startPath: "app" });
      expect(found).toEqual({ ok: true, configPath: await realpath(join(root, "app/.uce.json")),
        workspacePath: await realpath(root), searchedDirectories: 1 });
      expect(Object.isFrozen(DEFAULT_PIPELINE_FILENAMES)).toBe(true);
    });
  });

  it("stops at the explicit workspace rather than reading a parent or JS file", async () => {
    await workspace(async root => {
      await mkdir(join(root, "app"));
      await writeFile(join(root, "uce.json"), "{}");
      await writeFile(join(root, "app/uce.config.js"), 'throw new Error("must not execute")');
      const found = await discoverPipelineDeclaration({ workspacePath: join(root, "app") });
      expect(found).toMatchObject({ ok: false, issues: [{ code: "config_not_found" }] });
    });
  });

  it("bounds upward traversal and allows a parent within the declared budget", async () => {
    await workspace(async root => {
      await mkdir(join(root, "app/nested"), { recursive: true });
      await writeFile(join(root, "uce.json"), "{}");
      expect(await discoverPipelineDeclaration({ workspacePath: root, startPath: "app/nested", maxDirectories: 2 }))
        .toMatchObject({ ok: false, issues: [{ category: "resource-limit", code: "max_discovery_directories_exceeded" }] });
      expect(await discoverPipelineDeclaration({ workspacePath: root, startPath: "app/nested", maxDirectories: 3 }))
        .toMatchObject({ ok: true, searchedDirectories: 3 });
    });
  });

  it("rejects starts and symlink candidates outside the workspace", async () => {
    await workspace(async root => {
      await mkdir(join(root, "app"));
      await writeFile(join(root, "outside.json"), "{}");
      expect(await discoverPipelineDeclaration({ workspacePath: join(root, "app"), startPath: ".." }))
        .toMatchObject({ ok: false, issues: [{ code: "config_discovery_outside_workspace" }] });
      await symlink(join(root, "outside.json"), join(root, "app/uce.json"), "file");
      expect(await discoverPipelineDeclaration({ workspacePath: join(root, "app") }))
        .toMatchObject({ ok: false, issues: [{ code: "config_discovery_outside_workspace" }] });
    });
  });

  it("does not skip a broken or non-file first candidate", async () => {
    await workspace(async root => {
      await writeFile(join(root, ".uce.json"), "{}");
      await mkdir(join(root, "uce.json"));
      expect(await discoverPipelineDeclaration({ workspacePath: root }))
        .toMatchObject({ ok: false, issues: [{ code: "config_discovery_not_file" }] });
    });
  });

  it("contains filesystem exceptions without local path disclosure", async () => {
    const found = await discoverPipelineDeclaration({ workspacePath: join(tmpdir(), "UCE_DISCOVERY_PRIVATE_MISSING") });
    expect(found).toMatchObject({ ok: false, issues: [{ code: "config_discovery_failed" }] });
    expect(JSON.stringify(found)).not.toContain("UCE_DISCOVERY_PRIVATE_MISSING");
  });
});
