import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getConfigValueAtPath } from "@0disoft/universal-config-engine-core";
import { loadConfig, loadValidatedConfig, type DeclaredValidatorFactory } from "../src/index.js";

async function withDeclaration(run: (cwd: string) => Promise<void>) {
  const cwd = await mkdtemp(join(tmpdir(), "uce-load-config-"));
  try {
    await writeFile(join(cwd, "uce.json"), JSON.stringify({ sources: [
      { id: "settings", kind: "object", priority: 0, value: { port: 3000 } },
      { id: "environment", kind: "process-env", priority: 10, mappings: [
        { externalName: "APP_PORT", targetPath: ["port"], sourceKind: "process-env", parseAs: "string" }
      ] }
    ], coercionRules: [{ path: ["port"], from: "string", to: "number", onFailure: "issue" }],
    limits: { maxKeyCount: 10 }, validators: [{ id: "schema", kind: "json-schema-ajv", schema: { type: "object" } }] }));
    await run(cwd);
  } finally { await rm(cwd, { recursive: true, force: true }); }
}

const validatorFactory: DeclaredValidatorFactory = declaration => ({ id: declaration.id,
  validate: input => ({ ok: typeof getConfigValueAtPath(input.config, ["port"]) === "number", issues: [] }) });

describe("application declaration facade", () => {
  it.each([
    { env: { APP_PORT: " " }, argv: [], expected: 3000 },
    { env: { APP_PORT: "8080" }, argv: [], expected: 8080 },
    { env: { APP_PORT: "0x10" }, argv: [], expected: undefined },
    { env: {}, argv: ["--port", "1.5"], expected: undefined }
  ])("forwards declared strict numeric and empty-input policies (%j)", async ({ env, argv, expected }) => {
    await withDeclaration(async cwd => {
      await writeFile(join(cwd, "uce.json"), JSON.stringify({ sources: [
        { id: "defaults", kind: "object", priority: 0, value: { port: 3000 } },
        { id: "env", kind: "process-env", priority: 1, mappings: [{ ...mappingPolicy, externalName: "APP_PORT", sourceKind: "process-env" }] },
        { id: "argv", kind: "argv", priority: 2, mappings: [{ ...mappingPolicy, externalName: "--port", sourceKind: "argv" }] }
      ] }));
      const pipeline = await loadConfig({ cwd, configPath: "uce.json", env, argv });
      if (expected === undefined) expect(pipeline.result.issues[0]?.code).toBe("mapping_number_format_invalid");
      else { expect(pipeline.result.ok).toBe(true); expect(pipeline.result.config).toEqual({ port: expected }); }
    });
  });
  it("applies declared coercion, budgets and validators without importing the CLI", async () => {
    await withDeclaration(async cwd => {
      const result = await loadConfig({ cwd, configPath: "uce.json", env: { APP_PORT: "8080" }, validatorFactory });
      expect(result.result.ok).toBe(true); expect(result.result.config).toEqual({ port: 8080 });
      expect(result.result.limits.maxKeyCount).toBe(10);
      expect(result.result.provenance.map(event => event.action)).toContain("coerced");
      expect(result.result.provenance.map(event => event.action)).toContain("validated");
    });
  });
  it("requires an explicit compiler and preserves loaded source status on a compile failure", async () => {
    await withDeclaration(async cwd => {
      const missing = await loadConfig({ cwd, configPath: "uce.json", env: {} });
      expect(missing.result.ok).toBe(false);
      expect(missing.report.issues[0]?.code).toBe("validator_factory_missing");
      expect(missing.report.sources[0]?.status).toBe("loaded");
      const observed = vi.fn();
      const failed = await loadConfig({ cwd, configPath: "uce.json", env: {}, onError: observed,
        validatorFactory() { throw new Error("UCE_FACTORY_PRIVATE"); } });
      expect(failed.report.issues[0]?.code).toBe("validator_compile_failed");
      expect(failed.report.sources[0]?.status).toBe("loaded");
      expect(JSON.stringify(failed.report)).not.toContain("UCE_FACTORY_PRIVATE");
      expect(observed).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({
        cause: expect.objectContaining({ message: "UCE_FACTORY_PRIVATE" })
      }) }));
    });
  });
  it("returns typed output separately and rejects a reused validator id", async () => {
    await withDeclaration(async cwd => {
      const validate = vi.fn(() => ({ ok: true, value: { listenPort: 3000 }, issues: [] }));
      const options = { cwd, configPath: "uce.json", env: {}, validatorFactory };
      const typed = await loadValidatedConfig({ ...options, outputValidator: { id: "output", validate } });
      expect(typed.ok).toBe(true);
      if (typed.ok) expect(typed.value.listenPort).toBe(3000);
      expect(typed.result.config).toEqual({ port: 3000 });
      validate.mockClear();
      const collision = await loadValidatedConfig({ ...options, outputValidator: { id: "schema", validate } });
      expect(collision.ok).toBe(false); expect(validate).not.toHaveBeenCalled();
      expect(collision.report.issues[0]?.code).toBe("typed_validator_id_conflict");
    });
  });
  it("normalizes declaration failures and honors cancellation before I/O", async () => {
    const controller = new AbortController(); controller.abort();
    const aborted = await loadConfig({ configPath: "must-not-read.json", signal: controller.signal });
    expect(aborted.report.issues[0]?.code).toBe("operation_aborted");
    const failed = await loadConfig({ configPath: "UCE_DECLARATION_PRIVATE.json" });
    expect(failed.result.ok).toBe(false); expect(JSON.stringify(failed.report)).not.toContain("UCE_DECLARATION_PRIVATE");
  });
});

const mappingPolicy = { targetPath: ["port"], parseAs: "number", numberFormat: "integer", emptyValue: "ignore" };
