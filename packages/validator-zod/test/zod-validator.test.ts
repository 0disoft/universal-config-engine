import { describe, expect, it } from "vitest";
import * as z from "zod";
import {
  resolveConfig,
  runValidators
} from "@universal-config-engine/core";
import { createZodValidator } from "../src/index.js";

describe("createZodValidator", () => {
  it("returns ok with validated output", async () => {
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
    const validator = createZodValidator({
      id: "zod:server",
      schema: z.object({
        server: z.object({
          port: z.number().int().positive()
        })
      })
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
      sourceId: "zod:server",
      message: "Validator zod:server completed with status ok."
    });
  });

  it("maps Zod paths into normalized config paths", async () => {
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
    const validator = createZodValidator({
      id: "zod:server",
      schema: z.object({
        server: z.object({
          port: z.number()
        })
      })
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
        sourceId: "zod:server"
      })
    );
    expect(validation.provenance).toContainEqual({
      path: [],
      action: "validated",
      sourceId: "zod:server",
      message: "Validator zod:server completed with status error."
    });
  });
});
