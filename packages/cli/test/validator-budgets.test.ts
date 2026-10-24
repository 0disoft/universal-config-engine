import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAjvValidator } from "@0disoft/universal-config-engine-validator-ajv";
import { createDeclaredValidators } from "../src/validators.js";
import { executeDeclaration } from "../src/execution.js";
import { withTempDir } from "./helpers/temp-directory.js";

vi.mock("@0disoft/universal-config-engine-validator-ajv", async importOriginal => {
  const actual = await importOriginal<typeof import("@0disoft/universal-config-engine-validator-ajv")>();
  return { ...actual, createAjvValidator: vi.fn(actual.createAjvValidator) };
});
afterEach(() => vi.clearAllMocks());

describe("validator compilation budgets", () => {
  it("rejects excess validators before inspecting entries or compiling schemas", () => {
    const validators = new Array(2);
    Object.defineProperty(validators, 0, { get() { throw new Error("Must not inspect"); } });
    const declaration = { sources: [], validators, limits: { maxProvenanceEvents: 1 } };
    expect(createDeclaredValidators(declaration)).toMatchObject({ validators: [], issues: [
      expect.objectContaining({ code: "max_provenance_events_exceeded" })
    ] });
    expect(createAjvValidator).not.toHaveBeenCalled();
  });

  it.each([42, { port: 80 }])("skips compilation after merge failure or exhausted merge history: %j", async value => {
    await withTempDir(async cwd => {
      const configPath = join(cwd, "uce.json");
      await writeFile(configPath, JSON.stringify({
        sources: [{ id: "file", kind: "object", priority: 0, value }],
        limits: { maxProvenanceEvents: 1 },
        validators: [{ id: "schema", kind: "json-schema-ajv", schema: { type: "object" } }]
      }));
      const pipeline = await executeDeclaration(configPath, { cwd, env: {}, stdout() {}, stderr() {} }, [], true);
      expect(pipeline.result.ok).toBe(false);
      expect(pipeline.result.issues).toContainEqual(expect.objectContaining({
        code: typeof value === "number" ? "root_not_object" : "max_provenance_events_exceeded"
      }));
      expect(createAjvValidator).not.toHaveBeenCalled();
    });
  });

  it("bounds compile failures while generating them", () => {
    const result = createDeclaredValidators({ sources: [], limits: { maxDiagnostics: 2 },
      validators: Array.from({ length: 10 }, (_, index) => ({
        id: `schema-${index}`, kind: "json-schema-ajv", schema: { type: "invalid-type" }
      })) });
    expect(result.issues.map(issue => issue.code)).toEqual(["validator_compile_failed", "max_diagnostics_exceeded"]);
    expect(createAjvValidator).toHaveBeenCalledTimes(3);
  });
});
