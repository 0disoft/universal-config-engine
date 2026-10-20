import { describe, expect, it } from "vitest";
import { applyCoercionRules, buildDiagnosticReport, createMappedOverrideSource, resolveConfig, type OverrideMapping } from "../src/index.js";

describe("mapping input ownership", () => {
  const descriptor = { id: "argv", kind: "argv" as const, priority: 1, displayName: "argv" };

  it.each([
    { code: "mapping_parse_failed", targetPath: ["auth", "token"], parseAs: "number" as const },
    { code: "unsafe_mapping_path", targetPath: ["constructor"], parseAs: "string" as const },
    { code: "mapping_set_failed", targetPath: ["items", 0], parseAs: "string" as const },
    { code: "duplicate_mapping_target_path", targetPath: ["auth", "token"], firstPath: ["auth", "token"], parseAs: "string" as const },
    { code: "overlapping_mapping_target_path", targetPath: ["auth", "token"], firstPath: ["auth"], parseAs: "string" as const }
  ])("detaches $code paths from reusable mapping declarations", ({ code, targetPath, firstPath, parseAs }) => {
    const expectedPath = [...targetPath];
    const mappings: OverrideMapping[] = [];
    if (firstPath !== undefined) mappings.push({ externalName: "FIRST", sourceKind: "argv", targetPath: firstPath });
    mappings.push({ externalName: "SECOND", sourceKind: "argv", targetPath, parseAs });
    const mapped = createMappedOverrideSource({ descriptor, values: { FIRST: "first", SECOND: "invalid" }, mappings });
    expect(mapped.issues?.map((issue) => issue.code)).toEqual([code]);
    targetPath.splice(0, targetPath.length, "reused");
    expect(mapped.issues?.[0]?.path).toEqual(expectedPath);
    expect(mapped.issues?.[0]?.path).not.toBe(targetPath);
    expect(Object.isFrozen(targetPath)).toBe(false);
    const report = buildDiagnosticReport(resolveConfig({ sources: [mapped] }));
    expect(report.issues[0]?.path).toEqual(expectedPath);
  });

  it.each(["toString", "constructor", "__proto__", "hasOwnProperty"])("maps only an explicitly supplied %s", (externalName) => {
    const mappings = [{ externalName, sourceKind: "argv" as const, targetPath: ["port"], parseAs: "number" as const }];
    const missing = createMappedOverrideSource({ descriptor, values: {}, mappings });
    expect(missing.value).toEqual({});
    expect(missing.issues).toEqual([]);
    expect(resolveConfig({ sources: [missing] }).ok).toBe(true);

    const supplied = createMappedOverrideSource({ descriptor, values: { [externalName]: "9000" }, mappings });
    expect(supplied.value).toEqual({ port: 9000 });
    expect(supplied.issues).toEqual([]);
  });

  it("ignores inherited input without invoking its getter", () => {
    const values = Object.create({
      get PORT(): string {
        throw new Error("An inherited value must not be inspected.");
      }
    }) as Record<string, string>;
    const result = createMappedOverrideSource({
      descriptor,
      values,
      mappings: [{ externalName: "PORT", sourceKind: "argv", targetPath: ["port"] }]
    });
    expect(result.value).toEqual({});
    expect(result.issues).toEqual([]);
  });
});

describe("JSON mapping validation", () => {
  function mapJson(raw: string) {
    return createMappedOverrideSource({
      descriptor: { id: "env", kind: "process-env", priority: 1, displayName: "env" },
      values: { PAYLOAD: raw },
      mappings: [{ externalName: "PAYLOAD", sourceKind: "process-env", targetPath: ["nested", "payload"], parseAs: "json" }]
    });
  }

  function coerceJson(raw: string) {
    return applyCoercionRules({
      config: { payload: raw },
      rules: [{ path: ["payload"], from: "string", to: "json", onFailure: "issue" }]
    });
  }

  it.each(["1e999", "-1e999", '{"note":"JSON input marker","nested":[1e999]}'])(
    "rejects non-finite JSON at the mapping boundary (%s)", (raw) => {
      const mapped = mapJson(raw);
      expect(mapped.value).toEqual({});
      expect(mapped.issues).toEqual([expect.objectContaining({
        category: "mapping", code: "mapping_parse_failed", severity: "error", sourceId: "env", path: ["nested", "payload"]
      })]);
      expect(resolveConfig({ sources: [mapped] }).ok).toBe(false);
      const coerced = coerceJson(raw);
      expect(coerced.config).toEqual({ payload: raw });
      expect(coerced.issues).toEqual([expect.objectContaining({ code: "coercion_failed" })]);
      expect(JSON.stringify([mapped.issues, coerced.issues])).not.toContain("JSON input marker");
    }
  );

  it.each(["__proto__", "constructor", "prototype"])("classifies nested JSON key %s before assignment", (key) => {
    for (const raw of [`{"nested":[{"${key}":"JSON input marker"}]}`, `{"${key}":1e999}`]) {
      const mapped = mapJson(raw);
      expect(mapped.value).toEqual({});
      expect(mapped.issues).toEqual([expect.objectContaining({
        category: "mapping", code: "unsafe_key", sourceId: "env", path: ["nested", "payload"]
      })]);
      const coerced = coerceJson(raw);
      expect(coerced.config).toEqual({ payload: raw });
      expect(coerced.issues).toEqual([expect.objectContaining({ category: "coercion", code: "unsafe_key" })]);
      expect(JSON.stringify([mapped.issues, coerced.issues])).not.toContain("JSON input marker");
    }
  });

  it.each(["null", "false", '"1e999"', "1.7976931348623157e308", '{"nested":[-1.7976931348623157e308,0]}'])(
    "accepts valid JSON consistently (%s)", (raw) => {
      const expected: unknown = JSON.parse(raw);
      const mapped = mapJson(raw);
      expect(mapped.issues).toEqual([]);
      expect(mapped.value).toEqual({ nested: { payload: expected } });
      const coerced = coerceJson(raw);
      expect(coerced.issues).toEqual([]);
      expect(coerced.config).toEqual({ payload: expected });
    }
  );

  it("retains stage-specific syntax errors without exposing parser exceptions", () => {
    const raw = '{"note":"JSON input marker",';
    const mapped = mapJson(raw);
    expect(mapped.value).toEqual({});
    expect(mapped.issues).toEqual([expect.objectContaining({ code: "mapping_parse_failed" })]);
    const coerced = coerceJson(raw);
    expect(coerced.config).toEqual({ payload: raw });
    expect(coerced.issues).toEqual([expect.objectContaining({ code: "coercion_failed" })]);
    expect(JSON.stringify([mapped.issues, coerced.issues])).not.toContain("JSON input marker");
  });
});
