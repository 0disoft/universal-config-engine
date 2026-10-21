import { describe, expect, it } from "vitest";
import { loadDeclaredSources, selectPipelineProfile, type PipelineDeclaration } from "../src/index.js";
import { resolveConfig } from "@0disoft/universal-config-engine-core";

const declaration = (): PipelineDeclaration => ({
  sources: [{ id: "defaults", kind: "object", priority: 0, value: { port: 80 } }],
  limits: { maxDepth: 16, maxKeyCount: 100 },
  profiles: { production: { sources: [{ id: "production", kind: "object", priority: 10, value: { port: 443 } }],
    limits: { maxDepth: 8 } } }
});

describe("explicit profile compilation", () => {
  it("inherits base limits before preflighting profile entries and keeps explicit overrides", () => {
    const sources = Array.from({ length: 65 }, (_, index) => ({
      id: `profile-${index}`, kind: "object" as const, priority: index, value: {}
    }));
    const value = { sources: [], limits: { maxSources: 100, maxDepth: 8 }, profiles: { production: { sources } } };
    const selected = selectPipelineProfile(value, "production");
    expect(selected.sources).toHaveLength(65);
    expect(selected.limits).toEqual(value.limits);
    expect(selectPipelineProfile(value).sources).toEqual([]);
    expect(selectPipelineProfile({ ...value, limits: { maxSources: 1 }, profiles: {
      production: { sources, limits: { maxSources: 100 } }
    } }, "production").sources).toHaveLength(65);
  });

  it("rejects excess profile entries against inherited limits before reading them", () => {
    const sources = new Array(2);
    Object.defineProperty(sources, 0, { get() { throw new Error("Must not inspect"); } });
    expect(() => selectPipelineProfile({ sources: [], limits: { maxSources: 1 }, profiles: { production: { sources } } },
      "production")).toThrow(expect.objectContaining({ issues: [expect.objectContaining({
      code: "max_sources_exceeded", path: ["profiles", "production", "sources"]
    })] }));
  });

  it("retains aggregate checks and does not hide malformed profile limits", () => {
    const sources = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => ({
      id: `${prefix}-${index}`, kind: "object" as const, priority: index, value: {}
    }));
    expect(() => selectPipelineProfile({ sources: sources("base", 40), limits: { maxSources: 100 },
      profiles: { production: { sources: sources("profile", 65) } } }, "production"))
      .toThrow(expect.objectContaining({ issues: [expect.objectContaining({ code: "max_sources_exceeded" })] }));
    expect(() => selectPipelineProfile({ sources: [], limits: { maxSources: 100 }, profiles: {
      production: { limits: "invalid" }
    } } as never)).toThrow(expect.objectContaining({ issues: [expect.objectContaining({ code: "pipeline_limits_invalid" })] }));
  });

  it("preserves base-only behavior unless a profile is selected", () => {
    const selected = selectPipelineProfile(declaration());
    expect(selected.sources.map(source => source.id)).toEqual(["defaults"]);
    expect(selected.profiles).toBeUndefined();
  });

  it("combines sources with their original identities, priorities and provenance", async () => {
    const selected = selectPipelineProfile(declaration(), "production");
    const sources = await loadDeclaredSources({ declaration: selected, configPath: "uce.json", cwd: process.cwd(), env: {}, argv: [] });
    const result = resolveConfig({ sources });
    expect(result.ok).toBe(true);
    expect(result.config).toEqual({ port: 443 });
    expect(result.resolvedPaths[0]).toMatchObject({ winningSourceId: "production", winningPriority: 10, overriddenSourceIds: ["defaults"] });
    expect(selected.limits).toEqual({ maxDepth: 8, maxKeyCount: 100 });
  });

  it("does not invent higher priorities or merge by replacing source ids", () => {
    const value = declaration();
    expect(() => selectPipelineProfile({ ...value, profiles: { production: {
      sources: [{ id: "defaults", kind: "object", priority: 10, value: {} }]
    } } }, "production")).toThrow();
    expect(selectPipelineProfile({ ...value, profiles: { production: {
      sources: [{ id: "production", kind: "object", priority: 0, value: {} }]
    } } }, "production").sources[1]?.priority).toBe(0);
  });

  it.each(["missing", "__proto__", "constructor"])("rejects an absent or unsafe selection", profile => {
    expect(() => selectPipelineProfile(declaration(), profile)).toThrow();
  });

  it("rechecks aggregate source budgets after selecting a profile", () => {
    const value = declaration();
    try {
      selectPipelineProfile({ ...value, profiles: { production: {
        ...value.profiles!.production, limits: { maxSources: 1 }
      } } }, "production");
      throw new Error("Expected profile budget failure.");
    } catch (error) {
      expect(error).toMatchObject({ issues: expect.arrayContaining([expect.objectContaining({ code: "max_sources_exceeded" })]) });
    }
  });

  it("rejects oversized profile maps before inspecting profile values", () => {
    const profiles = Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`p${index}`, {}]));
    Object.defineProperty(profiles, "p0", { get() { throw new Error("Profile entries must not be inspected"); } });
    try { selectPipelineProfile({ sources: [], profiles }); throw new Error("Expected profile limit failure."); }
    catch (error) { expect(error).toMatchObject({ issues: [{ code: "max_profiles_exceeded" }] }); }
  });

  it("rejects oversized profile sources before reading their entries", () => {
    const sources = new Array(100000);
    Object.defineProperty(sources, 0, { get() { throw new Error("Profile source entries must not be inspected"); } });
    try { selectPipelineProfile({ sources: [], profiles: { production: { sources } } }, "production");
      throw new Error("Expected profile source limit failure."); }
    catch (error) { expect(error).toMatchObject({ issues: [{ code: "max_sources_exceeded" }] }); }
  });

  it("does not accept nested profiles or arbitrary fields", () => {
    expect(() => selectPipelineProfile({ sources: [], profiles: { production: { profiles: {} } } } as never))
      .toThrow();
  });
});
