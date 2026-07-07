import { describe, expect, it } from "vitest";
import {
  resolveConfig,
  runValidators
} from "@0disoft/universal-config-engine-core";
import {
  createAjvValidator,
  instancePathToConfigPath
} from "../src/index.js";

describe("createAjvValidator", () => {
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
    expect(validation.provenance).toContainEqual({
      path: [],
      action: "validated",
      sourceId: "ajv:server",
      message: "Validator ajv:server completed with status error."
    });
  });
});

describe("instancePathToConfigPath", () => {
  it("decodes JSON pointer escaping and numeric array indexes", () => {
    expect(instancePathToConfigPath("/items/0/a~1b/~0key")).toEqual(["items", 0, "a/b", "~key"]);
  });
});
