import { describe, expect, it } from "vitest";
import { applyCoercionRules, getConfigValueAtPath, resolveConfig, setConfigValueAtPath } from "../src/index.js";
import { source } from "./helpers/source.js";

describe("applyCoercionRules", () => {
  it("coerces existing nested array elements without changing caller input", () => {
    const config = { items: ["41", { enabled: "true" }, ["{\"count\":2}"]] };
    const result = applyCoercionRules({ config, rules: [
      { path: ["items", 0], from: "string", to: "number", onFailure: "issue" },
      { path: ["items", 1, "enabled"], from: "string", to: "boolean", onFailure: "issue" },
      { path: ["items", 2, 0], from: "string", to: "json", onFailure: "issue" }
    ] });
    expect(result.issues).toEqual([]);
    expect(result.config).toEqual({ items: [41, { enabled: true }, [{ count: 2 }]] });
    expect(config).toEqual({ items: ["41", { enabled: "true" }, ["{\"count\":2}"]] });
    expect(result.provenance).toHaveLength(3);
  });

  it.each(["__proto__", "constructor", "prototype"])("rejects JSON key %s before setting the parsed value", (key) => {
    for (const payload of [`{"${key}":{"polluted":"rejected marker"}}`, `{"nested":[{"${key}":"rejected marker"}]}`]) {
      const result = applyCoercionRules({ config: { payload }, rules: [
        { path: ["payload"], from: "string", to: "json", onFailure: "issue" }
      ] });
      expect(result.config).toEqual({ payload });
      expect(result.issues).toEqual([expect.objectContaining({
        category: "coercion", code: "unsafe_key", path: ["payload"]
      })]);
      expect(JSON.stringify(result.issues)).not.toContain("rejected marker");
      expect(result.provenance).toEqual([]);
      expect(Object.prototype.hasOwnProperty.call(Object.prototype, "polluted")).toBe(false);
    }
  });

  it("keeps the public setter's numeric-write rejection contract", () => {
    expect(() => setConfigValueAtPath({ items: ["41"] }, ["items", 0], 41)).toThrow();
    const result = applyCoercionRules({ config: { items: ["41"] }, rules: [
      { path: ["items", -1], from: "string", to: "number", onFailure: "issue" },
      { path: ["items", 2], from: "string", to: "number", onFailure: "issue" }
    ] });
    expect(result.config).toEqual({ items: ["41"] });
    expect(result.issues).toEqual([]);
    expect(result.provenance).toEqual([]);
  });

  it("applies opt-in coercion rules and records provenance", () => {
    const result = resolveConfig({
      sources: [source("env", 10, { server: { port: "8080" } })],
      coercionRules: [
        {
          path: ["server", "port"],
          from: "string",
          to: "number",
          onFailure: "issue"
        }
      ]
    });

    expect(result.ok).toBe(true);
    expect(getConfigValueAtPath(result.config, ["server", "port"])).toBe(8080);
    expect(result.provenance).toContainEqual({
      path: ["server", "port"],
      action: "coerced",
      sourceId: "core:coercion",
      message: "Path was coerced from string to number."
    });
  });

  it("returns coerced config without mutating the public API input", () => {
    const config = { threshold: "41" } as const;
    const coercion = applyCoercionRules({
      config,
      rules: [
        {
          path: ["threshold"],
          from: "string",
          to: "number",
          onFailure: "issue"
        }
      ]
    });

    expect(config).toEqual({ threshold: "41" });
    expect(coercion.config).toEqual({ threshold: 41 });
    expect(coercion.config).not.toBe(config);
    expect(coercion.issues).toEqual([]);
  });

  it("rejects non-finite JSON coercion results", () => {
    const result = resolveConfig({
      sources: [source("env", 10, { threshold: "1e999" })],
      coercionRules: [
        {
          path: ["threshold"],
          from: "string",
          to: "json",
          onFailure: "issue"
        }
      ]
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        category: "coercion",
        code: "coercion_failed",
        path: ["threshold"],
        message: "Expected JSON-compatible value."
      })
    );
  });
});
