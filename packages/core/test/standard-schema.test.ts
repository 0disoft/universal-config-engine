import { describe, expect, it, vi } from "vitest";
import { createStandardSchemaValidator, runConfigPipeline, runValidators, type StandardConfigSchema } from "../src/index.js";

const schema = <T>(validate: StandardConfigSchema<T>["~standard"]["validate"]): StandardConfigSchema<T> =>
  ({ "~standard": { version: 1, vendor: "test", validate } });

describe("Standard Schema interoperability", () => {
  it("awaits a provider once and retains typed output only on the adapter", async () => {
    const validate = vi.fn(async () => ({ value: { port: 443 } }));
    const validator = createStandardSchemaValidator({ schema: schema(validate) });
    const result = await runConfigPipeline({ context: undefined, loaders: [{
      descriptor: { id: "defaults", kind: "object", priority: 0, displayName: "defaults" },
      load: () => ({ value: { port: "443" } })
    }], validators: [validator] });
    expect(result.result.ok).toBe(true);
    expect(result.result.config).toEqual({ port: "443" });
    expect(validate).toHaveBeenCalledTimes(1);
    expect(await validator.validate({ config: {}, provenance: [] })).toEqual({ ok: true, value: { port: 443 }, issues: [] });
  });

  it("normalizes typed paths without retaining provider prose or path arrays", async () => {
    const path = [{ key: "clients" }, { key: 0 }, { key: "password" }];
    const validator = createStandardSchemaValidator({ schema: schema(() => ({ issues: [{
      message: "UCE_STANDARD_PRIVATE_SENTINEL", path
    }] })) });
    const direct = await validator.validate({ config: {}, provenance: [] });
    path[2]!.key = "changed";
    expect(direct.issues).toEqual([{ code: "standard_schema_issue", severity: "error", path: ["clients", 0, "password"] }]);
    expect(JSON.stringify(direct)).not.toContain("UCE_STANDARD_PRIVATE_SENTINEL");
  });

  it.each([NaN, Infinity, -1, 1.5, Symbol("private")])("rejects an unrepresentable path segment", async segment => {
    const validator = createStandardSchemaValidator({ schema: schema(() => ({ issues: [{ message: "private", path: [segment] }] })) });
    expect((await validator.validate({ config: {}, provenance: [] })).issues[0]?.code).toBe("standard_schema_invalid_path");
  });

  it("bounds retained issues without reading a discarded provider tail", async () => {
    const issues = Array.from({ length: 10000 }, () => ({ message: "private" }));
    Object.defineProperty(issues, 2, { get() { throw new Error("discarded tail was read"); } });
    const validator = createStandardSchemaValidator({ maxIssues: 2, schema: schema(() => ({ issues })) });
    expect(await validator.validate({ config: {}, provenance: [] })).toEqual({ ok: false, issues: [
      { code: "standard_schema_issue", severity: "error" },
      { code: "standard_schema_issues_truncated", severity: "error" }
    ] });
  });

  it.each([null, {}, { issues: [] }, { issues: "private" }, { value: 1, issues: [{ message: "private" }] }])(
    "fails closed on malformed provider output", async raw => {
      const validator = createStandardSchemaValidator({ schema: schema(() => raw as never) });
      expect((await validator.validate({ config: {}, provenance: [] })).issues[0]?.code).toBe("standard_schema_invalid_result");
    }
  );

  it("accepts explicit undefined output but contains a rejected provider callback", async () => {
    const empty = createStandardSchemaValidator({ schema: schema(() => ({ value: undefined })) });
    expect(await empty.validate({ config: {}, provenance: [] })).toEqual({ ok: true, value: undefined, issues: [] });
    const rejected = createStandardSchemaValidator({ schema: schema(async () => { throw new Error("UCE_STANDARD_REJECTION_PRIVATE"); }) });
    const result = await runValidators({ config: {}, provenance: [], validators: [rejected] });
    expect(result.issues[0]?.code).toBe("validator_threw");
    expect(JSON.stringify(result)).not.toContain("UCE_STANDARD_REJECTION_PRIVATE");
  });
});
