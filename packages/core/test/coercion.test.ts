import { describe, expect, it } from "vitest";
import { applyCoercionRules, getConfigValueAtPath, resolveConfig } from "../src/index.js";
import { source } from "./helpers/source.js";

describe("applyCoercionRules", () => {
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
