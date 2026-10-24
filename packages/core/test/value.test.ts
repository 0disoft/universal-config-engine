import { describe, expect, it } from "vitest";
import {
  DEFAULT_RESOURCE_LIMITS,
  flattenConfigObject,
  isConfigValue,
  resolveConfig
} from "../src/index.js";
import { source } from "./helpers/source.js";

describe("isConfigValue", () => {
  it("rejects sparse arrays rather than narrowing holes to ConfigValue", () => {
    expect(isConfigValue(new Array(1))).toBe(false);
    expect(isConfigValue({ nested: [1, , 3] })).toBe(false);
  });

  it("rejects cycles in arrays, objects and mixed containers without throwing", () => {
    const array: unknown[] = [];
    array.push(array);
    const object: Record<string, unknown> = {};
    object.self = object;
    const mixed: unknown[] = [];
    mixed.push({ back: mixed });

    for (const value of [array, object, mixed]) {
      expect(isConfigValue(value)).toBe(false);
    }
  });

  it("checks array elements even when a metadata property shadows values", () => {
    const valid = Object.defineProperty([true], "values", { value: undefined });
    const invalid = Object.defineProperty([undefined], "values", { value: () => [true].values() });
    expect(isConfigValue(valid)).toBe(true);
    expect(isConfigValue(invalid)).toBe(false);
  });

  it("accepts shared acyclic references and deeply nested JSON-compatible values", () => {
    const shared = { enabled: true, values: [1, null, "value"] };
    expect(isConfigValue({ left: shared, right: shared })).toBe(true);
    let value: unknown = true;
    for (let depth = 0; depth < 20_000; depth += 1) {
      value = depth % 2 === 0 ? [value] : { nested: value };
    }
    expect(isConfigValue(value)).toBe(true);
  });

  it.each([undefined, Number.NaN, Infinity, () => 1, Symbol("value"), 1n, new Date(0)])(
    "rejects non-JSON input %s", (value) => {
      expect(isConfigValue(value)).toBe(false);
      expect(isConfigValue({ nested: [value] })).toBe(false);
    }
  );
});

describe("config leaf resource limits", () => {
  it.each(["object", "array"])("does not read %s values beyond the key/index budget", kind => {
    const container: Record<string, unknown> | unknown[] = kind === "array" ? [] : {};
    const maximum = 4;
    const admitted = kind === "array" ? maximum - 1 : maximum;
    let reads = 0;
    for (let index = 0; index < 1000; index++) {
      Object.defineProperty(container, kind === "array" ? index : `key${index}`, {
        enumerable: true, get() {
          reads++;
          if (index >= admitted) throw new Error("Discarded values must not be evaluated.");
          return index;
        }
      });
    }
    const value = kind === "array" ? { items: container } : container;
    const flattened = flattenConfigObject("input", value, { ...DEFAULT_RESOURCE_LIMITS, maxKeyCount: maximum });
    expect(flattened.issues).toContainEqual(expect.objectContaining({ code: "max_key_count_exceeded" }));
    expect(reads).toBe(admitted);
  });

  it("rejects unsafe keys without evaluating them or values beyond the diagnostic budget", () => {
    let reads = 0;
    const value = {};
    for (const key of ["__proto__", "discarded"]) {
      Object.defineProperty(value, key, { enumerable: true, get() {
        reads++;
        throw new Error("Rejected values must not be evaluated.");
      } });
    }
    const result = resolveConfig({ sources: [source("input", 0, value)], limits: { maxDiagnostics: 1 } });
    expect(result.ok).toBe(false);
    expect(result.config).toEqual({});
    expect(reads).toBe(0);
    expect(result.issues.some(issue => issue.code === "source_value_inspection_failed")).toBe(false);
  });

  const cases = [
    { limits: { maxDepth: 1 }, code: "max_depth_exceeded" },
    { limits: { maxPathLength: 1 }, code: "max_path_length_exceeded" }
  ];

  it.each(cases)("does not evaluate values beyond $code", ({ limits, code }) => {
    let reads = 0;
    const value = { outer: {} };
    Object.defineProperty(value.outer, "leaf", { enumerable: true, get() {
      reads++;
      throw new Error("Discarded leaves must not be evaluated.");
    } });
    const flattened = flattenConfigObject("input", value, { ...DEFAULT_RESOURCE_LIMITS, ...limits });
    expect(flattened.issues).toContainEqual(expect.objectContaining({ code }));
    expect(reads).toBe(0);
  });

  it.each(cases)("checks object scalar leaves against $code before merging", ({ limits, code }) => {
    for (const leaf of ["value", 42, true, null]) {
      const policy = { ...DEFAULT_RESOURCE_LIMITS, ...limits };
      expect(flattenConfigObject("input", { leaf }, policy)).toMatchObject({
        entries: [{ path: ["leaf"], value: leaf }], issues: []
      });

      const value = { outer: { leaf } };
      const flattened = flattenConfigObject("input", value, policy);
      expect(flattened.entries).toEqual([]);
      expect(flattened.issues).toEqual([expect.objectContaining({
        category: "resource-limit", code, path: ["outer", "leaf"], severity: "error"
      })]);

      const resolved = resolveConfig({ sources: [source("input", 0, value)], limits });
      expect(resolved.ok).toBe(false);
      expect(resolved.config).toEqual({});
      expect(resolved.provenance).toContainEqual(expect.objectContaining({ action: "rejected", sourceId: "input" }));
    }
  });

  it.each(cases)("checks scalar leaves introduced by JSON coercion against $code", ({ limits, code }) => {
    const result = resolveConfig({
      sources: [source("input", 0, { payload: '{"enabled":true}' })],
      coercionRules: [{ path: ["payload"], from: "string", to: "json", onFailure: "issue" }],
      limits
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      category: "resource-limit", code, sourceId: "core:resolved-config", path: ["payload", "enabled"]
    }));
  });
});

describe("flattenConfigObject array validation", () => {
  it("counts scalar array slots and accepts the exact key/index budget", () => {
    const value = { items: [1, 2, 3] };
    expect(flattenConfigObject("input", value, { ...DEFAULT_RESOURCE_LIMITS, maxKeyCount: 4 })).toMatchObject({
      entries: [{ path: ["items"], value: value.items }], issues: []
    });
    const failed = resolveConfig({ sources: [source("input", 0, value)], limits: { maxKeyCount: 3 } });
    expect(failed.ok).toBe(false);
    expect(failed.config).toEqual({});
    expect(failed.issues).toEqual([expect.objectContaining({ code: "max_key_count_exceeded" })]);
  });

  it("rejects exponential shared arrays before cloning or exhausting traversal work", () => {
    let reads = 0;
    const leaf = Object.defineProperty([0], 0, { get() {
      if (++reads > 64) throw new Error("Expanded traversal was not bounded.");
      return 0;
    } });
    let tree: unknown[] = leaf;
    for (let depth = 0; depth < 20; depth++) tree = [tree, tree];
    const input = { tree };
    const limits = { ...DEFAULT_RESOURCE_LIMITS, maxKeyCount: 64 };
    const flattened = flattenConfigObject("input", input, limits);
    expect(flattened.entries).toEqual([]);
    expect(flattened.issues).toEqual([expect.objectContaining({ code: "max_key_count_exceeded" })]);
    reads = 0;
    const result = resolveConfig({ sources: [source("input", 0, input)], limits });
    expect(result.ok).toBe(false);
    expect(result.config).toEqual({});
    expect(result.issues).toEqual([expect.objectContaining({ code: "max_key_count_exceeded" })]);
    expect(reads).toBeLessThanOrEqual(64);
  });

  const cyclic: unknown[] = [];
  cyclic.push(cyclic);

  it.each([
    { name: "undefined", value: [undefined], code: "invalid_value" },
    { name: "non-finite numbers", value: [Number.NaN], code: "invalid_value" },
    { name: "non-JSON objects", value: [new Date(0)], code: "invalid_value" },
    { name: "sparse arrays", value: new Array(1), code: "invalid_value" },
    { name: "unsafe nested keys", value: [{ constructor: "blocked" }], code: "unsafe_key" },
    { name: "cycles", value: cyclic, code: "cyclic_value" },
    { name: "nested cycles", value: [{ nested: cyclic }], code: "cyclic_value" }
  ])("does not emit arrays containing $name", ({ value, code }) => {
    const result = flattenConfigObject("input", { items: value, valid: true }, DEFAULT_RESOURCE_LIMITS);

    expect(result.issues).toContainEqual(expect.objectContaining({ code, severity: "error" }));
    expect(result.entries).toEqual([{ path: ["valid"], value: true }]);
  });

  it.each([
    { limits: { maxDepth: 1 }, code: "max_depth_exceeded" },
    { limits: { maxPathLength: 1 }, code: "max_path_length_exceeded" },
    { limits: { maxKeyCount: 1 }, code: "max_key_count_exceeded" }
  ])("does not emit arrays that exceed $code", ({ limits, code }) => {
    const result = flattenConfigObject("input", { items: [{ enabled: true }] }, {
      ...DEFAULT_RESOURCE_LIMITS,
      ...limits
    });

    expect(result.issues).toContainEqual(expect.objectContaining({ code }));
    expect(result.entries).toEqual([]);
  });

  it("stops incomplete array validation when the diagnostic budget is exhausted", () => {
    const result = flattenConfigObject("input", {
      items: [{ first: undefined, second: undefined, third: undefined }, cyclic]
    }, { ...DEFAULT_RESOURCE_LIMITS, maxDiagnostics: 1 });

    expect(result.entries).toEqual([]);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: "max_diagnostics_exceeded", severity: "error" })
    ]);
  });

  it("preserves the original diagnostic when validation ends exactly at the budget", () => {
    const result = flattenConfigObject("input", { items: [undefined] }, {
      ...DEFAULT_RESOURCE_LIMITS,
      maxDiagnostics: 1
    });

    expect(result.entries).toEqual([]);
    expect(result.issues).toEqual([expect.objectContaining({ code: "invalid_value" })]);
  });

  it("emits valid arrays atomically, allowing shared references and earlier unrelated errors", () => {
    const shared = { enabled: true };
    const items = [shared, shared, [1, null, "value"], []];
    const result = flattenConfigObject("input", { invalid: undefined, items, empty: [] }, DEFAULT_RESOURCE_LIMITS);

    expect(result.entries).toEqual([
      { path: ["items"], value: items },
      { path: ["empty"], value: [] }
    ]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.code).toBe("invalid_value");
  });

  it("rejects invalid arrays before merge even when source warnings fill the public issue budget", () => {
    const result = resolveConfig({
      sources: [
        source("defaults", 0, { enabled: true }),
        {
          ...source("invalid", 1, { items: [undefined, cyclic] }),
          issues: [{
            category: "parse",
            code: "source_warning",
            severity: "warning",
            message: "Source warning."
          }]
        }
      ],
      limits: { maxDiagnostics: 1 }
    });

    expect(result.ok).toBe(false);
    expect(result.config).toEqual({ enabled: true });
    expect(result.issues).toEqual([expect.objectContaining({ code: "max_diagnostics_exceeded" })]);
    expect(result.provenance).toContainEqual(expect.objectContaining({ sourceId: "invalid", action: "rejected" }));
  });
});
