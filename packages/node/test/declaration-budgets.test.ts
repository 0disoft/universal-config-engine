import { describe, expect, it } from "vitest";
import { loadDeclaredSources } from "../src/pipeline/source-loading.js";
import { validatePipelineDeclaration } from "../src/pipeline/declaration-validation.js";

describe("declaration budget preflight", () => {
  it("requires explicit boolean constraint disclosure policy", () => {
    const declaration = { sources: [], validators: [{ id: "schema", kind: "json-schema-ajv", schema: true, includeConstraints: "true" }] };
    expect(validatePipelineDeclaration(declaration)).toContainEqual(expect.objectContaining({ code: "pipeline_validator_constraints_invalid" }));
    expect(validatePipelineDeclaration({ ...declaration, validators: [{ ...declaration.validators[0], includeConstraints: true }] })).toEqual([]);
  });
  it("rejects excess validators before inspecting their entries", () => {
    const validators = new Array(2);
    Object.defineProperty(validators, 0, { get() { throw new Error("Must not inspect"); } });
    expect(validatePipelineDeclaration({ sources: [], validators, limits: { maxProvenanceEvents: 1 } })).toEqual([
      expect.objectContaining({ code: "max_provenance_events_exceeded" })
    ]);
  });
  it.each([1, 64])("rejects excess sources without inspecting entries at limit %s", maximum => {
    let reads = 0;
    const sources = new Array(maximum + 1);
    Object.defineProperty(sources, 0, { get() { reads += 1; throw new Error("must not inspect"); } });
    const issues = validatePipelineDeclaration({ sources, limits: { maxSources: maximum } });
    expect(issues).toEqual([expect.objectContaining({ code: "max_sources_exceeded" })]);
    expect(reads).toBe(0);
  });

  it.each(["maxSources", "maxDepth", "maxPathLength", "maxKeyCount", "maxDiagnostics",
    "maxProvenanceEvents", "maxResolvedPaths", "maxReportBytes"])("rejects unsafe integer %s limits", field => {
    expect(validatePipelineDeclaration({ sources: [], limits: { [field]: 1e100 } })).toContainEqual(
      expect.objectContaining({ code: "pipeline_limit_value_invalid", path: ["limits", field] }));
    expect(validatePipelineDeclaration({ sources: [], limits: { [field]: Number.MAX_SAFE_INTEGER } })).toEqual([]);
  });

  it("preflights the public source loader before descriptor access or I/O", async () => {
    let reads = 0;
    const sources = Array.from({ length: 2 }, (_, index) => ({
      get id() { reads += 1; return `source${index}`; },
      kind: "json-file" as const, priority: index, path: "not-read.json"
    }));
    await expect(loadDeclaredSources({ declaration: { sources, limits: { maxSources: 1 } },
      cwd: process.cwd(), configPath: "not-read.json", env: {}, argv: [] })).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: "max_sources_exceeded" })]
    });
    expect(reads).toBe(0);
    await expect(loadDeclaredSources({ declaration: { sources: [], limits: { maxSources: 1e100 } },
      cwd: process.cwd(), configPath: "not-read.json", env: {}, argv: [] })).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: "pipeline_limit_value_invalid" })]
    });
  });
});
