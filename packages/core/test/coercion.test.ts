import { describe, expect, it } from "vitest";
import { applyCoercionRules, buildDiagnosticReport, getConfigValueAtPath, resolveConfig, setConfigValueAtPath, type CoercionRule } from "../src/index.js";
import { source } from "./helpers/source.js";

describe("applyCoercionRules", () => {
  it("stops failed-rule work and allocations at diagnostic overflow", () => {
    let reads = 0;
    const rule: CoercionRule = { get path() { reads++; return ["flag"]; }, from: "string", to: "boolean", onFailure: "issue" };
    const result = applyCoercionRules({ config: { flag: "invalid" }, rules: Array<CoercionRule>(10_000).fill(rule),
      limits: { maxDiagnostics: 1 } });
    expect(result.issues).toEqual([expect.objectContaining({ code: "max_diagnostics_exceeded" })]);
    expect(reads).toBeLessThanOrEqual(4);
    expect(result.config).toEqual({ flag: "invalid" });
  });

  it("preflights excessive no-op rules before reading rules or cloning config", () => {
    const rule: CoercionRule = { get path(): string[] { throw new Error("Must not inspect rules."); },
      from: "string", to: "number", onFailure: "issue" };
    const config = { get flag(): string { throw new Error("Must not copy config."); } };
    const result = applyCoercionRules({ config, rules: Array<CoercionRule>(100_000).fill(rule) });
    expect(result.config).toEqual({});
    expect(result.issues).toEqual([expect.objectContaining({ code: "max_coercion_rules_exceeded" })]);
    const exact = applyCoercionRules({ config: { enabled: true }, limits: { maxProvenanceEvents: 2 },
      rules: Array<CoercionRule>(2).fill({ path: ["absent"], from: "string", to: "number", onFailure: "issue" }) });
    expect(exact.issues).toEqual([]);
  });

  it("shares the aggregate event budget and synchronizes only completed conversions", () => {
    const result = resolveConfig({ sources: [source("input", 0, { payload: '{"count":"41"}' })],
      limits: { maxProvenanceEvents: 2 }, coercionRules: [
        { path: ["payload"], from: "string", to: "json", onFailure: "issue" },
        { path: ["payload", "count"], from: "string", to: "number", onFailure: "issue" }
      ] });
    expect(result.ok).toBe(false);
    expect(result.config).toEqual({ payload: { count: "41" } });
    expect(result.resolvedPaths.map(entry => entry.path)).toEqual([["payload", "count"]]);
    expect(result.provenance).toHaveLength(2);
    expect(result.issues).toEqual([expect.objectContaining({ code: "max_provenance_events_exceeded" })]);
  });

  it("does not convert a value when incoming history already fills the event budget", () => {
    const result = applyCoercionRules({ config: { port: "41" },
      rules: [{ path: ["port"], from: "string", to: "number", onFailure: "issue" }],
      limits: { maxProvenanceEvents: 1 }, provenance: [{ path: ["port"], action: "defined", sourceId: "input", message: "Defined." }] });
    expect(result.config).toEqual({ port: "41" });
    expect(result.provenance).toEqual([]);
    expect(result.issues).toEqual([expect.objectContaining({ code: "max_provenance_events_exceeded" })]);
  });

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

  it("skips coercion after merge has already exhausted the provenance budget", () => {
    const input = {
      payload: JSON.stringify({ nested: '{"value":7}', empty: {} }), list: ["41"]
    };
    const result = resolveConfig({ sources: [source("env", 0, input)], coercionRules: [
      { path: ["payload"], from: "string", to: "json", onFailure: "issue" },
      { path: ["payload", "nested"], from: "string", to: "json", onFailure: "issue" },
      { path: ["list", 0], from: "string", to: "number", onFailure: "issue" }
    ], limits: { maxProvenanceEvents: 1 } });
    expect(result.resolvedPaths.map((entry) => entry.path)).toEqual([["payload"], ["list"]]);
    expect(result.config).toEqual(input);
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
