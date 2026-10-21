import { describe, expect, it, vi } from "vitest";
import {
  createStandardSchemaValidator, runValidatedConfigPipeline, type ConfigLoader, type ValidatorAdapter
} from "../src/index.js";

const loader = (value: unknown): ConfigLoader => ({
  descriptor: { id: "defaults", kind: "object", priority: 0, displayName: "defaults" }, load: () => ({ value })
});
const success = (): ValidatorAdapter<{ port: number }> => ({ id: "typed", validate: () => ({ ok: true, value: { port: 443 }, issues: [] }) });

describe("separate validated pipeline output", () => {
  it("infers transformed output while preserving resolved config and provenance", async () => {
    const validate = vi.fn(async (value: unknown) => {
      expect(Object.isFrozen(value)).toBe(true);
      return { value: { port: Number((value as { port: string }).port) } };
    });
    const outputValidator = createStandardSchemaValidator({ schema: { "~standard": { version: 1, vendor: "test", validate } } });
    const result = await runValidatedConfigPipeline({ context: undefined, loaders: [loader({ port: "443" })], outputValidator });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected valid typed output.");
    const port: number = result.value.port;
    expect(port).toBe(443);
    expect(result.result.config).toEqual({ port: "443" });
    expect(result.result.resolvedPaths[0]?.winningSourceId).toBe("defaults");
    expect(result.result.provenance.at(-1)).toMatchObject({ action: "validated", sourceId: "standard-schema" });
    expect(validate).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result.report)).not.toContain('"value"');
  });

  it("does not invoke output validation after an earlier pipeline failure", async () => {
    const validate = vi.fn(success().validate);
    const result = await runValidatedConfigPipeline({ context: undefined, loaders: [loader({ port: 0 })],
      validators: [{ id: "required", validate: () => ({ ok: false, issues: [{ code: "invalid_port", severity: "error" }] }) }],
      outputValidator: { id: "typed", validate } });
    expect(result.ok).toBe(false);
    expect(Object.hasOwn(result, "value")).toBe(false);
    expect(validate).not.toHaveBeenCalled();
  });

  it("contains rejected callbacks without exposing a typed value or exception", async () => {
    const result = await runValidatedConfigPipeline({ context: undefined, loaders: [loader({ port: 80 })],
      outputValidator: { id: "typed", async validate() { throw new Error("UCE_TYPED_PRIVATE_REJECTION"); } } });
    expect(result.ok).toBe(false);
    expect(Object.hasOwn(result, "value")).toBe(false);
    expect(result.report.issues[0]?.code).toBe("validator_threw");
    expect(JSON.stringify(result.report)).not.toContain("UCE_TYPED_PRIVATE_REJECTION");
  });

  it("retains the ordinary malformed-adapter diagnostic for a null result", async () => {
    const result = await runValidatedConfigPipeline({ context: undefined, loaders: [loader({})],
      outputValidator: { id: "typed", validate: () => null as never } });
    expect(result.ok).toBe(false);
    expect(result.report.issues[0]?.code).toBe("validator_result_invalid");
  });

  it("requires an own output value but accepts explicit undefined output", async () => {
    const missing = await runValidatedConfigPipeline({ context: undefined, loaders: [loader({})],
      outputValidator: { id: "typed", validate: () => ({ ok: true, issues: [] }) } });
    expect(missing.ok).toBe(false);
    expect(missing.report.issues[0]?.code).toBe("typed_output_missing");
    const empty = await runValidatedConfigPipeline({ context: undefined, loaders: [loader({})],
      outputValidator: { id: "typed", validate: () => ({ ok: true, value: undefined, issues: [] }) } });
    expect(empty.ok).toBe(true);
    expect(Object.hasOwn(empty, "value")).toBe(true);
  });

  it("withholds output when an adapter's success flag contradicts an error", async () => {
    const result = await runValidatedConfigPipeline({ context: undefined, loaders: [loader({})],
      outputValidator: { id: "typed", validate: () => ({ ok: true, value: { secret: "UCE_TYPED_PRIVATE_OUTPUT" },
        issues: [{ code: "bad_output", severity: "error" }] }) } });
    expect(result.ok).toBe(false);
    expect(Object.hasOwn(result, "value")).toBe(false);
    expect(JSON.stringify(result.report)).not.toContain("UCE_TYPED_PRIVATE_OUTPUT");
  });

  it("shares provenance budgets and does not invoke a skipped output validator", async () => {
    const validate = vi.fn(success().validate);
    const result = await runValidatedConfigPipeline({ context: undefined, loaders: [loader({ port: 80 })],
      limits: { maxProvenanceEvents: 2 }, validators: [{ id: "base", validate: () => ({ ok: true, issues: [] }) }],
      outputValidator: { id: "typed", validate } });
    expect(result.ok).toBe(false);
    expect(result.report.issues.some(issue => issue.code === "max_provenance_events_exceeded")).toBe(true);
    expect(validate).not.toHaveBeenCalled();
  });

  it("rejects duplicate validator identity before loading or parsing twice", async () => {
    const load = vi.fn(() => ({ value: {} }));
    const validator = success();
    const result = await runValidatedConfigPipeline({ context: undefined, loaders: [{ ...loader({}), load }],
      validators: [validator], outputValidator: validator });
    expect(result.ok).toBe(false);
    expect(result.report.issues[0]?.code).toBe("typed_validator_id_conflict");
    expect(load).not.toHaveBeenCalled();
  });

  it("rejects excessive validators before walking their entries", async () => {
    const validators: ValidatorAdapter[] = new Array(100000);
    Object.defineProperty(validators, 0, { get() { throw new Error("Excessive entries were read"); } });
    const result = await runValidatedConfigPipeline({ context: undefined, loaders: [], validators,
      limits: { maxProvenanceEvents: 2 }, outputValidator: success() });
    expect(result.ok).toBe(false);
    expect(result.report.issues[0]?.code).toBe("max_provenance_events_exceeded");
  });

  it("withholds typed output if the diagnostic report exceeds its byte budget", async () => {
    const validate = vi.fn(success().validate);
    const result = await runValidatedConfigPipeline({ context: undefined,
      loaders: [loader(Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`key${index}`, index])))],
      limits: { maxReportBytes: 1024 }, outputValidator: { id: "typed", validate } });
    expect(result.ok).toBe(false);
    expect(result.report.status).toBe("error");
    expect(Object.hasOwn(result, "value")).toBe(false);
    expect(validate).not.toHaveBeenCalled();
  });
});
