import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import * as z from "zod";
import {
  resolveConfig,
  runConfigPipeline,
  runValidators
} from "@0disoft/universal-config-engine-core";
import { createZodValidator } from "../src/index.js";

describe("createZodValidator", () => {
  it.each([
    { schema: z.number().min(5, "UCE_SCHEMA_PRIVATE"), config: 4, constraint: { kind: "minimum", limit: 5 } },
    { schema: z.string().max(2, "UCE_SCHEMA_PRIVATE"), config: "abc", constraint: { kind: "maxLength", limit: 2 } },
    { schema: z.number().gt(5), config: 5, constraint: { kind: "exclusiveMinimum", limit: 5 } },
    { schema: z.array(z.string()).min(2), config: [], constraint: { kind: "minItems", limit: 2 } },
    { schema: z.number().int(), config: 1.5, constraint: { kind: "type", expected: "integer" } }
  ])("keeps optional public constraints separate from provider messages (%j)", async ({ schema, config, constraint }) => {
    const ordinary = await createZodValidator({ schema }).validate({ config, provenance: [] });
    expect(ordinary.issues[0]?.constraint).toBeUndefined();
    const opted = await createZodValidator({ schema, includeConstraints: true }).validate({ config, provenance: [] });
    expect(opted.issues[0]?.constraint).toEqual(constraint);
    expect(JSON.stringify(opted)).not.toContain("UCE_SCHEMA_PRIVATE");
  });
  it("bounds converted errors, preserves exact limits and reserves a truncation slot", async () => {
    const schema = z.object({ items: z.array(z.number()) });
    const input = { config: { items: Array(1000).fill("invalid") }, provenance: [] };
    expect((await createZodValidator({ schema, maxIssues: 2 }).validate(input)).issues).toEqual([
      { code: "invalid_type", severity: "error", path: ["items", 0] },
      { code: "zod_issues_truncated", severity: "error" }
    ]);
    expect((await createZodValidator({ schema, maxIssues: 1 }).validate(input)).issues).toEqual([
      { code: "zod_issues_truncated", severity: "error" }
    ]);
    const exact = await createZodValidator({ schema, maxIssues: 2 }).validate({ config: { items: ["a", "b"] }, provenance: [] });
    expect(exact.issues.map(issue => issue.path)).toEqual([["items", 0], ["items", 1]]);
  });

  it.each([undefined, 0, -1, NaN, Infinity, 1.5])("uses the default issue budget for %s", async maxIssues => {
    const result = await createZodValidator({ schema: z.array(z.number()), ...(maxIssues === undefined ? {} : { maxIssues }) })
      .validate({ config: Array(201).fill("invalid"), provenance: [] });
    expect(result.issues).toHaveLength(200);
    expect(result.issues.at(-1)?.code).toBe("zod_issues_truncated");
  });

  it("caps explicit conversion budgets at 10,000", async () => {
    const result = await createZodValidator({ schema: z.array(z.number()), maxIssues: 100_000 })
      .validate({ config: Array(10_001).fill("invalid"), provenance: [] });
    expect(result.issues).toHaveLength(10_000);
    expect(result.issues.at(-1)?.code).toBe("zod_issues_truncated");
  });

  it("awaits an asynchronous refinement exactly once", async () => {
    let calls = 0;
    const validator = createZodValidator({
      schema: z.object({ port: z.number().refine(async (port) => {
        await Promise.resolve();
        calls++;
        return port > 0;
      }) })
    });
    const result = await validator.validate({ config: { port: 3000 }, provenance: [] });

    expect(result).toEqual({ ok: true, value: { port: 3000 }, issues: [] });
    expect(calls).toBe(1);
  });

  it("retains asynchronous validation paths and redacts private issue messages", async () => {
    const pipeline = await runConfigPipeline({
      context: undefined,
      loaders: [{
        descriptor: { id: "defaults", kind: "object", priority: 0, displayName: "defaults" },
        load: () => ({ value: { auth: { password: "example-value" } } })
      }],
      validators: [createZodValidator({
        id: "async-schema",
        schema: z.object({ auth: z.object({ password: z.string().refine(async () => {
          await Promise.resolve();
          return false;
        }, { message: "private-refinement-message" }) }) })
      })]
    });

    expect(pipeline.result.ok).toBe(false);
    expect(pipeline.result.issues).toEqual([expect.objectContaining({
      code: "custom", path: ["auth", "password"], severity: "error", sourceId: "async-schema"
    })]);
    expect(pipeline.report.issues[0]?.message).toContain("redacted");
    expect(JSON.stringify(pipeline.report)).not.toContain("private-refinement-message");
    expect(JSON.stringify(pipeline.report)).not.toContain("example-value");
  });

  it("keeps asynchronous transform output adapter-local", async () => {
    const validator = createZodValidator({
      schema: z.object({ port: z.string().transform(async (port) => {
        await Promise.resolve();
        return Number(port);
      }) })
    });
    const result = await validator.validate({ config: { port: "3000" }, provenance: [] });
    expect(result).toEqual({ ok: true, value: { port: 3000 }, issues: [] });

    let observed: unknown;
    const pipeline = await runConfigPipeline({
      context: undefined,
      loaders: [{
        descriptor: { id: "defaults", kind: "object", priority: 0, displayName: "defaults" },
        load: () => ({ value: { port: "3000" } })
      }],
      validators: [validator, { id: "observer", validate(input) {
        observed = input.config;
        return { ok: true, issues: [] };
      } }]
    });
    expect(pipeline.result.ok).toBe(true);
    expect(pipeline.result.config).toEqual({ port: "3000" });
    expect(observed).toEqual({ port: "3000" });
  });

  it.each(["refinement", "transform"])(
    "normalizes rejected async %s promises without terminating Node", (kind) => {
      const result = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--input-type=module", "--eval", `
        import assert from "node:assert/strict";
        import * as z from "zod";
        import { runValidators } from "@0disoft/universal-config-engine-core";
        import { createZodValidator } from ${JSON.stringify(new URL("../dist/index.js", import.meta.url).href)};
        const reject = async () => {
          await Promise.resolve();
          throw new Error("private-async-exception");
        };
        const field = ${JSON.stringify(kind)} === "refinement"
          ? z.string().refine(reject) : z.string().transform(reject);
        const validation = await runValidators({
          config: { value: "example-value" }, provenance: [],
          validators: [createZodValidator({ schema: z.object({ value: field }) })]
        });
        assert.equal(validation.issues[0].code, "validator_threw");
        assert.equal(validation.issues[0].severity, "error");
        assert.equal(JSON.stringify(validation).includes("private-async-exception"), false);
        await new Promise(setImmediate);
        process.stdout.write("rejection-normalized");
      `], { cwd: new URL("..", import.meta.url), encoding: "utf8", timeout: 5000 });

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("rejection-normalized");
    }
  );

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
        sourceId: "zod:server"
      })
    );
    expect(adapterResult.issues).toEqual([
      {
        code: "invalid_type",
        severity: "error",
        path: ["server", "port"]
      }
    ]);
    expect(validation.provenance).toContainEqual({
      path: [],
      action: "validated",
      sourceId: "zod:server",
      message: "Validator zod:server completed with status error."
    });
  });
});
