import { describe, expect, it } from "vitest";
import { buildPublicDiagnosticReport, normalizeValidatorConstraint, runConfigPipeline, type ValidatorConstraint } from "../src/index.js";

describe("public validator constraints", () => {
  it.each([NaN, Infinity, -Infinity, "private", null])("omits non-finite/non-numeric bounds (%s)", limit => {
    expect(normalizeValidatorConstraint({ kind: "minimum", limit })).toBeUndefined();
  });
  it("copies only allowlisted rules, expected types and finite bounds", () => {
    expect(normalizeValidatorConstraint({ kind: "minimum", limit: -1, message: "UCE_CONSTRAINT_PRIVATE" })).toEqual({ kind: "minimum", limit: -1 });
    expect(normalizeValidatorConstraint({ kind: "type", expected: "integer", received: "UCE_CONSTRAINT_PRIVATE" })).toEqual({ kind: "type", expected: "integer" });
    expect(normalizeValidatorConstraint({ kind: "type", expected: "UCE_CONSTRAINT_PRIVATE" })).toBeUndefined();
    expect(normalizeValidatorConstraint({ kind: "pattern", pattern: "UCE_CONSTRAINT_PRIVATE" })).toBeUndefined();
  });
  it("preserves safe public constraints but masks secret paths and public-share metadata", async () => {
    const constraint = { kind: "minimum", limit: 12345, message: "UCE_CONSTRAINT_PRIVATE" } as unknown as ValidatorConstraint;
    const pipeline = await runConfigPipeline({ context: undefined,
      loaders: [{ descriptor: { id: "defaults", kind: "object", priority: 0, displayName: "defaults" }, load: () => ({ value: {} }) }],
      validators: [{ id: "schema", validate: () => ({ ok: false, issues: [
        { code: "minimum", severity: "error", path: ["port"], constraint },
        { code: "minimum", severity: "error", path: ["password"], constraint }
      ] }) }]
    });
    expect(pipeline.report.issues[0]?.constraint).toEqual({ kind: "minimum", limit: 12345 });
    expect(pipeline.report.issues[1]?.constraint).toBeUndefined();
    expect(JSON.stringify(pipeline)).not.toContain("UCE_CONSTRAINT_PRIVATE");
    expect(JSON.stringify(buildPublicDiagnosticReport(pipeline.report))).not.toContain("12345");
  });
});
