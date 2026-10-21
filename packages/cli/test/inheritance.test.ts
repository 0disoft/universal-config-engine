import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "@0disoft/universal-config-engine-core";
import { loadDeclaredSources, loadPipelineDeclaration, loadPipelineDeclarationContext } from "../src/index.js";
import { withTempDir } from "./helpers/temp-directory.js";

const object = (id: string, port = 80) => ({ id, kind: "object", priority: port, value: { port } });
async function save(root: string, path: string, value: unknown) { await writeFile(join(root, path), JSON.stringify(value)); }

describe("bounded declaration inheritance", () => {
  it("retains origin-relative files, profile selection and source provenance", async () => {
    await withTempDir(async root => {
      await mkdir(join(root, "common")); await mkdir(join(root, "service"));
      await save(root, "common/data.json", { port: 80 });
      await save(root, "common/base.json", { sources: [{ id: "base", kind: "json-file", priority: 0, path: "data.json" }],
        profiles: { production: { sources: [object("production", 443)] } } });
      await save(root, "service/uce.json", { extends: ["../common/base.json"], sources: [object("service", 100)] });
      const context = await loadPipelineDeclarationContext("service/uce.json", root, { workspacePath: root, profile: "production" });
      const sources = await loadDeclaredSources({ ...context, configPath: context.canonicalConfigPath, cwd: root, env: {}, argv: [] });
      const result = resolveConfig({ sources });
      expect(result.ok).toBe(true); expect(result.config).toEqual({ port: 443 });
      expect(result.resolvedPaths[0]).toMatchObject({ winningSourceId: "production", overriddenSourceIds: ["base", "service"] });
      expect(context.declarationPaths).toHaveLength(2);
      const plain = await loadPipelineDeclaration("service/uce.json", root, { workspacePath: root });
      expect(plain.sources[0]).toMatchObject({ path: join(root, "common/data.json") });
      await expect(loadPipelineDeclarationContext("service/uce.json", root)).rejects.toMatchObject({
        issues: [expect.objectContaining({ code: "pipeline_inheritance_outside_workspace" })] });
      await expect(loadPipelineDeclarationContext("service/uce.json", root, { workspacePath: root, profile: "missing" }))
        .rejects.toMatchObject({ issues: [{ code: "pipeline_profile_not_found", category: "usage", severity: "error", message: expect.any(String) }] });
    });
  });

  it("deduplicates shared ancestors in deterministic parent-first order", async () => {
    await withTempDir(async root => {
      await save(root, "base.json", { sources: [object("base")] });
      await save(root, "left.json", { extends: ["base.json"], sources: [object("left")] });
      await save(root, "right.json", { extends: ["base.json"], sources: [object("right")] });
      await save(root, "uce.json", { extends: ["left.json", "right.json"], sources: [object("child")] });
      expect((await loadPipelineDeclaration("uce.json", root)).sources.map(source => source.id)).toEqual(["base", "left", "right", "child"]);
      await save(root, "base.json", { extends: ["uce.json"], sources: [] });
      await expect(loadPipelineDeclaration("uce.json", root)).rejects.toMatchObject({ issues: [{ code: "pipeline_inheritance_cycle", category: "source-load", severity: "error", message: expect.any(String) }] });
    });
  });

  it("rejects aggregate source collisions and source budgets", async () => {
    await withTempDir(async root => {
      await save(root, "base.json", { sources: [object("same")] });
      await save(root, "uce.json", { extends: ["base.json"], sources: [object("same")] });
      await expect(loadPipelineDeclaration("uce.json", root)).rejects.toMatchObject({ issues: expect.arrayContaining([expect.objectContaining({ code: "pipeline_source_id_duplicate" })]) });
      await save(root, "uce.json", { extends: ["base.json"], sources: [object("child")], limits: { maxSources: 1 } });
      await expect(loadPipelineDeclaration("uce.json", root)).rejects.toMatchObject({ issues: [expect.objectContaining({ code: "max_sources_exceeded" })] });
    });
  });

  it("bounds unique files and aggregate bytes before parsing another document", async () => {
    await withTempDir(async root => {
      for (let i = 0; i < 17; i++) await save(root, `${i}.json`, { sources: [], ...(i < 16 ? { extends: [`${i + 1}.json`] } : {}) });
      await expect(loadPipelineDeclaration("0.json", root)).rejects.toMatchObject({ issues: [expect.objectContaining({ code: "max_declarations_exceeded" })] });
      for (let i = 0; i < 5; i++) await writeFile(join(root, `${i}.json`), JSON.stringify({ sources: [], ...(i < 4 ? { extends: [`${i + 1}.json`] } : {}) }) + " ".repeat(900_000));
      await expect(loadPipelineDeclaration("0.json", root)).rejects.toMatchObject({ issues: [expect.objectContaining({ code: "max_declaration_bytes_exceeded" })] });
    });
  });

  it("rejects a parent symlink that leaves the default workspace", async () => {
    await withTempDir(async root => {
      await mkdir(join(root, "service")); await save(root, "outside.json", { sources: [] });
      await symlink(join(root, "outside.json"), join(root, "service/parent.json"), "file");
      await save(root, "service/uce.json", { sources: [], extends: ["parent.json"] });
      await expect(loadPipelineDeclaration("service/uce.json", root)).rejects.toMatchObject({ issues: [expect.objectContaining({ code: "pipeline_inheritance_outside_workspace" })] });
    });
  });
});
