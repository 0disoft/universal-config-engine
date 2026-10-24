import { describe, expect, it } from "vitest";
import { buildConfigDiff, checkConfigChanges, createMappedOverrideSource, resolveConfig,
  type ConfigComparisonOptions, type OverrideMapping } from "../src/index.js";
import { source } from "./helpers/source.js";

const mapping: OverrideMapping = { externalName: "PORT", sourceKind: "process-env", targetPath: ["port"], parseAs: "number" };
function mapped(raw: string, policy: Partial<OverrideMapping> = {}) {
  return createMappedOverrideSource({ descriptor: { id: "env", kind: "process-env", priority: 0, displayName: "env" },
    mappings: [{ ...mapping, ...policy }], values: { PORT: raw } });
}

describe("opt-in mapping policies", () => {
  it.each([["", 0], ["  ", 0], ["0x10", 16], ["1e3", 1000], [" 1 ", 1]] as const)(
    "preserves Number compatibility by default (%s)", (raw, expected) => {
      expect(mapped(raw).value).toEqual({ port: expected });
      expect(mapped(raw).issues).toEqual([]);
    });
  it.each(["", "  ", "0x10", "1e3", " 1 ", ".5", "1."])("rejects non-decimal syntax (%s)", raw => {
    expect(mapped(raw, { numberFormat: "decimal" }).issues?.[0]?.code).toBe("mapping_number_format_invalid");
  });
  it.each([["01", 1], ["-1.25", -1.25], ["+0.5", 0.5]] as const)("accepts explicit decimals (%s)", (raw, expected) => {
    expect(mapped(raw, { numberFormat: "decimal" }).value).toEqual({ port: expected });
  });
  it.each([String(Number.MAX_SAFE_INTEGER), String(Number.MIN_SAFE_INTEGER), "-0"])("accepts safe integers (%s)", raw => {
    expect(mapped(raw, { numberFormat: "integer" }).issues).toEqual([]);
  });
  it.each(["9007199254740992", "-9007199254740992"])("rejects the unsafe integer boundary (%s)", raw => {
    expect(mapped(raw, { numberFormat: "integer" }).issues?.[0]?.code).toBe("mapping_integer_out_of_range");
  });
  it("ignores or rejects whitespace-only input explicitly without leaking it", () => {
    const ignored = mapped(" \t", { emptyValue: "ignore", numberFormat: "integer" });
    expect(ignored.value).toEqual({}); expect(ignored.issues).toEqual([]);
    expect(mapped(" \t", { emptyValue: "error" }).issues?.[0]?.code).toBe("mapping_empty_value");
    expect(mapped("1.5", { numberFormat: "integer" }).issues?.[0]?.code).toBe("mapping_number_format_invalid");
    expect(mapped("1", { numberFormat: "decimal", parseAs: "string" }).issues?.[0]?.code).toBe("mapping_policy_invalid");
  });
  it("does not reserve ignored targets or discard their secret policy", () => {
    const result = createMappedOverrideSource({ descriptor: { id: "env", kind: "process-env", priority: 0, displayName: "env" },
      mappings: [{ ...mapping, emptyValue: "ignore", secret: true }, { ...mapping, externalName: "FALLBACK" }],
      values: { PORT: " ", FALLBACK: "80" } });
    expect(result.issues).toEqual([]); expect(result.value).toEqual({ port: 80 });
    expect(result.descriptor.redaction?.secretPaths).toEqual([["port"]]);
  });
});

function located(value: unknown, id = "file", line = 1) {
  return resolveConfig({ sources: [{ ...source(id, 0, value), locations: [
    { path: ["port"], location: { sourceId: id, sourcePath: "settings.json", line, column: 1 } }
  ] }] });
}
const selection = (name: "values" | "sources" | "locations"): ConfigComparisonOptions => ({
  values: name === "values", sources: name === "sources", locations: name === "locations"
});

describe("independent comparison policies", () => {
  it("separates location edits, source ownership and value/type changes", () => {
    const before = located({ port: 80 });
    expect(buildConfigDiff(before, located({ port: 80 }, "file", 2)).changes[0]?.kinds).toContain("source-changed");
    expect(buildConfigDiff(before, located({ port: 80 }, "file", 2), { comparison: selection("values") }).changes).toEqual([]);
    expect(buildConfigDiff(before, located({ port: 80 }, "file", 2), { comparison: selection("sources") }).changes).toEqual([]);
    expect(buildConfigDiff(before, located({ port: 80 }, "other"), { comparison: selection("locations") }).changes).toEqual([]);
    expect(buildConfigDiff(before, located({ port: 80 }, "other"), { comparison: selection("sources") }).changes[0]?.kinds).toContain("source-changed");
    expect(buildConfigDiff(before, located({ port: "80" }), { comparison: selection("values") }).changes[0]?.kinds).toContain("type-changed");
    expect(buildConfigDiff(before, located({ port: 81 }), { comparison: selection("locations") }).changes).toEqual([]);
  });
  it("uses policy-owned comparison settings and never caller overrides", () => {
    const before = located({ port: 80 });
    const rules = [{ id: "stable", path: [], mode: "forbid-changes" }];
    const defaultPolicy = { version: "change-policy-1", rules };
    const valuesOnly = { ...defaultPolicy, comparison: selection("values") };
    expect(checkConfigChanges(before, located({ port: 80 }, "file", 2), valuesOnly).policy.status).toBe("passed");
    expect(checkConfigChanges(before, located({ port: 81 }), valuesOnly).policy.status).toBe("failed");
    const override = { comparison: selection("sources") } as never;
    expect(checkConfigChanges(before, located({ port: 81 }), defaultPolicy, override).policy.status).toBe("failed");
    expect(checkConfigChanges(before, located({ port: 81 }), Object.assign(Object.create({ comparison: selection("sources") }), defaultPolicy)).policy.status).toBe("failed");
    const metadataOnly = { ...defaultPolicy, comparison: selection("sources") };
    expect(checkConfigChanges(before, located({ port: 81 }), metadataOnly).policy.status).toBe("passed");
    expect(checkConfigChanges(before, located({ port: 80, added: true }), metadataOnly).policy.status).toBe("failed");
    expect(checkConfigChanges(before, located({ port: 80 }, "other"), { ...valuesOnly,
      rules: [{ id: "allowed", path: [], mode: "allowed-sources", allowedSourceIds: ["file"] }] }).policy.violations[0]?.code).toBe("source_not_allowed");
  });
  it("does not require secret-value comparison when only metadata is selected", () => {
    const before = located({ password: "UCE_SECRET_BEFORE" });
    const after = located({ password: "UCE_SECRET_AFTER" });
    const check = checkConfigChanges(before, after, { version: "change-policy-1", comparison: selection("sources"),
      rules: [{ id: "stable", path: [], mode: "forbid-changes" }] });
    expect(check.policy.status).toBe("passed"); expect(check.diff.uncomparedSecretPaths).toEqual([]);
    expect(JSON.stringify(check)).not.toContain("UCE_SECRET_BEFORE");
    const detected = buildConfigDiff(before, after, { comparison: selection("sources"), detectSecretChanges: true });
    expect(detected.secretComparison).toBe("skipped");
  });
  it.each([{ values: null }, { values: false, sources: false, locations: false }, { unknown: true }])(
    "rejects invalid comparison selections (%j)", comparison => {
      const result = located({ port: 80 });
      expect(buildConfigDiff(result, result, { comparison: comparison as never }).status).toBe("error");
      expect(checkConfigChanges(result, result, { version: "change-policy-1", rules: [], comparison }).policy.violations[0]?.code).toBe("invalid_policy");
    });
});
