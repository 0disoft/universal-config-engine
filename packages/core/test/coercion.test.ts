import { describe, expect, it } from "vitest";
import { applyCoercionRules, buildDiagnosticReport, getConfigValueAtPath, resolveConfig, setConfigValueAtPath } from "../src/index.js";
import { source } from "./helpers/source.js";

describe("applyCoercionRules", () => {
  it.each([
    { key: "value", raw: "42", code: null },
    { key: "value", raw: "invalid", code: "coercion_failed" }
  ])("detaches rule paths in retained output ($key, $code)", ({ key, raw, code }) => {
    const path = [key];
    const result = applyCoercionRules({ config: { [key]: raw },
      rules: [{ path, from: "string", to: "number", onFailure: "issue" }] });
    const retained = code === null ? result.provenance[0] : result.issues[0];
    if (code !== null) expect(result.issues[0]?.code).toBe(code);
    path.splice(0, path.length, "reused");
    expect(retained?.path).toEqual([key]);
    expect(retained?.path).not.toBe(path);
    expect(Object.isFrozen(path)).toBe(false);
  });

  it("projects JSON-expanded paths with inherited source history and locations", () => {
    const lower = source("vault", 0, { auth: "lower input" });
    const higher = source("file", 10, { auth: '{"password":"redaction marker","nested":{"port":"41"}}', stable: true });
    const lowerLocation = { sourceId: "vault", line: 2, column: 1 };
    const higherLocation = { sourceId: "file", line: 4, column: 3 };
    const result = resolveConfig({ sources: [
      { ...lower, locations: [{ path: ["auth"], location: lowerLocation }] },
      { ...higher, locations: [{ path: ["auth"], location: higherLocation }] }
    ], coercionRules: [
      { path: ["auth"], from: "string", to: "json", onFailure: "issue" },
      { path: ["auth", "nested", "port"], from: "string", to: "number", onFailure: "issue" }
    ] });
    expect(result.ok).toBe(true);
    expect(result.resolvedPaths.map((entry) => entry.path)).toEqual([["auth", "password"], ["auth", "nested", "port"], ["stable"]]);
    for (const entry of result.resolvedPaths.filter((entry) => entry.path[0] === "auth")) {
      expect(entry).toMatchObject({ winningSourceId: "file", winningPriority: 10,
        overriddenSourceIds: ["vault"], winningLocation: higherLocation, overriddenLocations: [lowerLocation] });
      expect(getConfigValueAtPath(result.config, entry.path)).not.toBeUndefined();
    }
    expect(buildDiagnosticReport(result).resolvedPaths).toContainEqual(expect.objectContaining({
      path: ["auth", "password"], redacted: true, redactionReason: "secret-name"
    }));
    expect(JSON.stringify(buildDiagnosticReport(result))).not.toContain("redaction marker");
  });

  it("synchronizes chained JSON expansion even when retained provenance is full", () => {
    const result = resolveConfig({ sources: [source("env", 0, {
      payload: JSON.stringify({ nested: '{"value":7}', empty: {} }), list: ["41"]
    })], coercionRules: [
      { path: ["payload"], from: "string", to: "json", onFailure: "issue" },
      { path: ["payload", "nested"], from: "string", to: "json", onFailure: "issue" },
      { path: ["list", 0], from: "string", to: "number", onFailure: "issue" }
    ], limits: { maxProvenanceEvents: 1 } });
    expect(result.resolvedPaths.map((entry) => entry.path)).toEqual([
      ["payload", "nested", "value"], ["payload", "empty"], ["list"]
    ]);
    expect(result.config).toEqual({ payload: { nested: { value: 7 }, empty: {} }, list: [41] });
    expect(result.provenance).toHaveLength(1);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "max_provenance_events_exceeded" }));
  });

  it("applies the resolved-path budget after JSON expands a single leaf", () => {
    const result = resolveConfig({ sources: [source("env", 0, { payload: '{"first":1,"second":2}' })],
      coercionRules: [{ path: ["payload"], from: "string", to: "json", onFailure: "issue" }],
      limits: { maxResolvedPaths: 1 }
    });
    expect(result.ok).toBe(false);
    expect(result.resolvedPaths).toHaveLength(1);
    expect(result.resolvedPaths[0]?.path).toEqual(["payload", "first"]);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "max_resolved_paths_exceeded" }));
  });

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
