import { describe, expect, it } from "vitest";
import {
  applyCoercionRules, cloneConfigValue, createMappedOverrideSource, getConfigValueAtPath, resolveConfig,
  type ConfigValue
} from "../src/index.js";
import { source } from "./helpers/source.js";

const descriptor = { id: "env", kind: "process-env" as const, priority: 1, displayName: "env" };
const rules = [{ path: ["payload"], from: "string" as const, to: "json" as const, onFailure: "issue" as const }];

function mapJson(raw: string) {
  return createMappedOverrideSource({ descriptor, values: { PAYLOAD: raw }, mappings: [
    { externalName: "PAYLOAD", sourceKind: "process-env", targetPath: ["payload"], parseAs: "json" }
  ] });
}

describe("deep JSON boundaries", () => {
  it.each(["array", "object"])("reports configured limits instead of syntax/set failures for deep %s JSON", (kind) => {
    const depth = 6_000;
    const raw = kind === "array"
      ? "[".repeat(depth) + '"deep input marker"' + "]".repeat(depth)
      : '{"child":'.repeat(depth) + '"deep input marker"' + "}".repeat(depth);
    const mapped = mapJson(raw);
    expect(mapped.issues).toEqual([]);
    const coerced = applyCoercionRules({ config: { payload: raw }, rules });
    expect(coerced.issues).toEqual([]);
    expect(coerced.provenance).toHaveLength(1);

    for (const limits of [{ maxDepth: 8 }, { maxDepth: 64, maxPathLength: 8 }]) {
      for (const result of [resolveConfig({ sources: [mapped], limits }),
        resolveConfig({ sources: [source("env", 1, { payload: raw })], coercionRules: rules, limits })]) {
        expect(result.ok).toBe(false);
        expect(result.issues).toEqual([expect.objectContaining({
          category: "resource-limit", code: "maxDepth" in limits && limits.maxDepth === 8
            ? "max_depth_exceeded" : "max_path_length_exceeded"
        })]);
        expect(JSON.stringify(result.issues)).not.toContain("deep input marker");
      }
    }
  });

  it("detects unsafe keys beyond the native reviver stack limit", () => {
    const raw = "[".repeat(6_000) + '{"constructor":"deep input marker"}' + "]".repeat(6_000);
    for (const result of [mapJson(raw), applyCoercionRules({ config: { payload: raw }, rules })]) {
      expect(result.issues).toEqual([expect.objectContaining({ code: "unsafe_key" })]);
      expect(JSON.stringify(result.issues)).not.toContain("deep input marker");
    }
  });

  it.each(["array", "object"])("honors large caller-selected limits for %s JSON without overflowing", (kind) => {
    const raw = kind === "array" ? "[".repeat(6_000) + "true" + "]".repeat(6_000)
      : '{"child":'.repeat(6_000) + "true" + "}".repeat(6_000);
    const limits = { maxDepth: 6_001, maxPathLength: 6_001 };
    for (const result of [resolveConfig({ sources: [mapJson(raw)], limits }),
      resolveConfig({ sources: [source("env", 1, { payload: raw })], coercionRules: rules, limits })]) {
      expect(result.ok).toBe(true);
      expect(result.issues).toEqual([]);
      const segment = kind === "array" ? 0 : "child";
      expect(getConfigValueAtPath(result.config, ["payload", ...new Array<string | number>(6_000).fill(segment)])).toBe(true);
    }
    const exceeded = resolveConfig({ sources: [source("env", 1, { payload: raw })], coercionRules: rules,
      limits: { maxDepth: 5_000, maxPathLength: 6_001 } });
    expect(exceeded.ok).toBe(false);
    expect(exceeded.issues).toEqual([expect.objectContaining({ category: "resource-limit", code: "max_depth_exceeded" })]);
  });

  it("can replace a deeply expanded object and remove its original path index", () => {
    const raw = '{"child":'.repeat(6_000) + "true" + "}".repeat(6_000);
    const result = resolveConfig({ sources: [mapJson(raw), source("override", 10, { payload: false })],
      limits: { maxDepth: 6_001, maxPathLength: 6_001 } });
    expect(result.ok).toBe(true);
    expect(result.config).toEqual({ payload: false });
    expect(result.resolvedPaths).toEqual([expect.objectContaining({ path: ["payload"], winningSourceId: "override" })]);
  });

  it("still classifies malformed deep JSON as a syntax failure", () => {
    expect(mapJson("[".repeat(6_000)).issues).toEqual([
      expect.objectContaining({ category: "mapping", code: "mapping_parse_failed" })
    ]);
  });
});

describe("iterative config cloning", () => {
  it("clones deep mixed containers without sharing input objects", () => {
    let value: ConfigValue = true;
    const path: (string | number)[] = [];
    for (let index = 0; index < 6_000; index += 1) {
      value = index % 2 === 0 ? [value] : { child: value };
      path.unshift(index % 2 === 0 ? 0 : "child");
    }
    const cloned = cloneConfigValue(value);
    expect(cloned === value).toBe(false);
    expect(getConfigValueAtPath(cloned, path)).toBe(true);
  });

  it("preserves sparse arrays, detached shared references and null object prototypes", () => {
    const shared = { enabled: true };
    const input = { left: shared, right: shared, sparse: [1, , 3] as ConfigValue[] };
    const cloned = cloneConfigValue(input) as Record<string, ConfigValue>;
    expect(Object.getPrototypeOf(cloned)).toBe(null);
    expect(cloned.left).toEqual(shared);
    expect(cloned.left).not.toBe(shared);
    expect(cloned.left).not.toBe(cloned.right);
    expect(Object.hasOwn(cloned.sparse as readonly ConfigValue[], 1)).toBe(false);
  });

  it("rejects cycles instead of looping indefinitely", () => {
    const cyclic: ConfigValue[] = [];
    cyclic.push(cyclic);
    expect(() => cloneConfigValue(cyclic)).toThrow();
  });
});
