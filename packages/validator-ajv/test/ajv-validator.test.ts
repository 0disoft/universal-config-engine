import { describe, expect, it } from "vitest";
import { Ajv } from "ajv/dist/ajv.js";
import {
  buildDiagnosticReport,
  resolveConfig,
  runValidators
} from "@0disoft/universal-config-engine-core";
import {
  createAjvValidator,
  instancePathToConfigPath
} from "../src/index.js";

describe("createAjvValidator", () => {
  it.each([
    ["required", "password"],
    ["additionalProperties", "password"],
    ["required", "0"],
    ["additionalProperties", "0"],
    ["required", "a/b~c"],
    ["additionalProperties", "a/b~c"],
    ["required", ""],
    ["additionalProperties", ""]
  ])("reports and redacts the exact property path for %s (%s)", async (keyword, property) => {
    const path = ["items", 0, "auth", property];
    const result = resolveConfig({ sources: [{
      descriptor: {
        id: "defaults", kind: "object", priority: 0, displayName: "defaults",
        redaction: { secretPaths: [path] }
      },
      value: { items: [{ auth: keyword === "required" ? {} : { [property]: "fixture-value" } }] }
    }] });
    const validator = createAjvValidator({ schema: {
      type: "object",
      properties: { items: { type: "array", items: {
        type: "object",
        properties: { auth: {
          type: "object", properties: {}, required: [property], additionalProperties: false
        } }
      } } }
    } });
    const validation = await runValidators({
      config: result.config, provenance: result.provenance, validators: [validator]
    });
    expect(validation.issues).toEqual([
      expect.objectContaining({ code: keyword, path })
    ]);
    const report = buildDiagnosticReport({ ...result, ok: false, issues: validation.issues });
    expect(report.issues[0]?.message).toBe(
      "Diagnostic message redacted because it is associated with a secret path or source."
    );
    expect(JSON.stringify(report)).not.toContain("fixture-value");
  });

  it.each(["$privateSentinel", "_privateSentinel", "private$Sentinel", "a".repeat(129)])(
    "bounds custom keyword diagnostics without retaining the keyword (%s)",
    async (keyword) => {
      const ajv = new Ajv();
      ajv.addKeyword({ keyword, validate: () => false });
      const validator = createAjvValidator({ ajv, schema: { [keyword]: true } });
      const adapterResult = await validator.validate({ config: {}, provenance: [] });
      expect(adapterResult.ok).toBe(false);
      expect(adapterResult.issues).toEqual([
        { code: "ajv_custom_keyword", severity: "error", path: [] }
      ]);
      const result = await runValidators({ config: {}, provenance: [], validators: [validator] });
      expect(result.issues).toContainEqual(expect.objectContaining({
        category: "validation", code: "ajv_custom_keyword"
      }));
      expect(JSON.stringify(result)).not.toContain(keyword);
    }
  );

  it("returns ok for JSON Schema-valid config", async () => {
    const result = resolveConfig({
      sources: [
        {
          descriptor: {
            id: "defaults",
            kind: "object",
            priority: 0,
            displayName: "defaults"
          },
          value: {
            server: {
              port: 3000
            }
          }
        }
      ]
    });
    const validator = createAjvValidator({
      id: "ajv:server",
      schema: {
        type: "object",
        required: ["server"],
        properties: {
          server: {
            type: "object",
            required: ["port"],
            properties: {
              port: {
                type: "integer",
                minimum: 1
              }
            }
          }
        }
      }
    });
    const validation = await runValidators({
      config: result.config,
      provenance: result.provenance,
      validators: [validator]
    });

    expect(validation.issues).toEqual([]);
    expect(validation.provenance).toContainEqual({
      path: [],
      action: "validated",
      sourceId: "ajv:server",
      message: "Validator ajv:server completed with status ok."
    });
  });

  it("maps Ajv instance paths into normalized config paths", async () => {
    const result = resolveConfig({
      sources: [
        {
          descriptor: {
            id: "env",
            kind: "object",
            priority: 10,
            displayName: "env"
          },
          value: {
            server: {
              port: "not-a-number"
            }
          }
        }
      ]
    });
    const validator = createAjvValidator({
      id: "ajv:server",
      schema: {
        type: "object",
        required: ["server"],
        properties: {
          server: {
            type: "object",
            required: ["port"],
            properties: {
              port: {
                type: "number"
              }
            }
          }
        }
      }
    });
    const adapterResult = await validator.validate({
      config: result.config,
      provenance: result.provenance
    });
    const validation = await runValidators({
      config: result.config,
      provenance: result.provenance,
      validators: [validator]
    });

    expect(validation.issues).toContainEqual(
      expect.objectContaining({
        category: "validation",
        severity: "error",
        path: ["server", "port"],
        sourceId: "ajv:server"
      })
    );
    expect(adapterResult.issues).toEqual([
      {
        code: "type",
        severity: "error",
        path: ["server", "port"]
      }
    ]);
    expect(validation.provenance).toContainEqual({
      path: [],
      action: "validated",
      sourceId: "ajv:server",
      message: "Validator ajv:server completed with status error."
    });
  });
});

describe("instancePathToConfigPath", () => {
  it("normalizes slash-only instance paths to the root path", () => {
    expect(instancePathToConfigPath("/")).toEqual([]);
  });

  it("decodes JSON pointer escaping and uses config shape for array indexes", () => {
    expect(
      instancePathToConfigPath(
        "/items/0/a~1b/~0key",
        { items: [{ "a/b": { "~key": true } }] }
      )
    ).toEqual(["items", 0, "a/b", "~key"]);
  });

  it("preserves numeric object keys and ambiguous segments as strings", () => {
    expect(
      instancePathToConfigPath(
        "/featureFlags/0/enabled",
        { featureFlags: { "0": { enabled: false } } }
      )
    ).toEqual(["featureFlags", "0", "enabled"]);
    expect(instancePathToConfigPath("/items/0/name")).toEqual(["items", "0", "name"]);
  });
});
