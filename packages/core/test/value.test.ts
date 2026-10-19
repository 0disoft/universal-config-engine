import { describe, expect, it } from "vitest";
import {
  DEFAULT_RESOURCE_LIMITS,
  flattenConfigObject,
  resolveConfig
} from "../src/index.js";
import { source } from "./helpers/source.js";

describe("flattenConfigObject array validation", () => {
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
