import { describe, expect, it, vi } from "vitest";
import { Ajv } from "ajv/dist/ajv.js";
import {
  buildDiagnosticReport,
  resolveConfig,
  runValidators,
  runValidatedConfigPipeline
} from "@0disoft/universal-config-engine-core";
import {
  createAjvValidator,
  instancePathToConfigPath
} from "../src/index.js";

describe("createAjvValidator", () => {
  const typedRun = (value: Record<string, string | number>, outputValidator: ReturnType<typeof createAjvValidator>) =>
    runValidatedConfigPipeline({ context: undefined, outputValidator, loaders: [{
      descriptor: { id: "settings", kind: "object", priority: 0, displayName: "settings" },
      load: () => ({ value })
    }] });

  it("isolates modifying keywords supplied through options as well as custom instances", async () => {
    const validator = createAjvValidator({
      options: { keywords: [{ keyword: "normalizePort", modifying: true,
        validate(_schema: unknown, data: { port: string | number }) {
          data.port = Number(data.port);
          return true;
        }
      }] },
      schema: { type: "object", normalizePort: true }
    });
    const input = Object.freeze({ port: "3000" });
    const direct = await validator.validate({ config: input, provenance: [] });
    expect(direct).toMatchObject({ ok: true, value: { port: 3000 } });
    expect(input.port).toBe("3000");
    expect(direct.value).not.toBe(input);
    const run = await typedRun({ port: "3000" }, validator);
    expect(run.ok).toBe(true);
    if (run.ok) expect(run.value).toEqual({ port: 3000 });
    expect(run.result.config).toEqual({ port: "3000" });
  });

  it.each([false, true])("returns coerced typed output without mutating resolved config (custom Ajv: %s)", async custom => {
    const schema = { type: "object", properties: { port: { type: "number" } } };
    const validator = createAjvValidator({ schema, ...(custom
      ? { ajv: new Ajv({ coerceTypes: true }) } : { options: { coerceTypes: true } }) });
    const run = await typedRun({ port: "3000" }, validator);
    expect(run.ok).toBe(true);
    if (run.ok) expect(run.value).toEqual({ port: 3000 });
    expect(run.result.config).toEqual({ port: "3000" });
  });

  it("returns defaults and stripped fields only in the validated output", async () => {
    const validator = createAjvValidator({ options: { useDefaults: true, removeAdditional: true }, schema: {
      type: "object", required: ["port"], additionalProperties: false,
      properties: { port: { type: "number", default: 3000 } }
    } });
    const run = await typedRun({ extra: "input marker" }, validator);
    expect(run.ok).toBe(true);
    if (run.ok) expect(run.value).toEqual({ port: 3000 });
    expect(run.result.config).toEqual({ extra: "input marker" });
  });

  it("isolates modifying custom keywords on supplied instances", async () => {
    const ajv = new Ajv();
    ajv.addKeyword({ keyword: "normalizePort", modifying: true, validate(_schema: unknown, data: { port: string | number }) {
      data.port = Number(data.port);
      return true;
    } });
    const run = await typedRun({ port: "3000" }, createAjvValidator({ ajv,
      schema: { type: "object", normalizePort: true } }));
    expect(run.ok).toBe(true);
    if (run.ok) expect(run.value).toEqual({ port: 3000 });
    expect(run.result.config).toEqual({ port: "3000" });
  });

  it("silences default schema logging while preserving an explicit application logger", () => {
    const schema = { type: "object", properties: { review_field: { minimum: 0 } } };
    const consoleWarning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const validator = createAjvValidator({ schema });
      expect(validator.validate({ config: {}, provenance: [] })).toMatchObject({ ok: true });
      expect(consoleWarning).not.toHaveBeenCalled();
      const warning = vi.fn();
      createAjvValidator({ schema, options: { logger: { log() {}, warn: warning, error() {} } } });
      expect(warning).toHaveBeenCalled();
    } finally { consoleWarning.mockRestore(); }
  });

  it("stops default validation at the first failing item", async () => {
    let reads = 0;
    const items = Array.from({ length: 300 }, () => "invalid");
    const config = { items: new Proxy(items, { get(target, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key)) reads += 1;
      return Reflect.get(target, key, receiver);
    } }) };
    const validator = createAjvValidator({ schema: { type: "object", properties: {
      items: { type: "array", items: { allOf: Array.from({ length: 30 }, () => ({ type: "number" })) } }
    } } });
    const result = await validator.validate({ config, provenance: [] });
    expect(result.issues).toHaveLength(1);
    // One validation read and one read while normalizing the retained issue path.
    expect(reads).toBe(2);
  });

  it.each([false, true])("bounds explicitly collected errors (custom Ajv: %s)", async customAjv => {
    const validator = createAjvValidator({ maxIssues: 3,
      schema: { type: "array", items: { type: "number" } },
      ...(customAjv ? { ajv: new Ajv({ allErrors: true }) } : { options: { allErrors: true } })
    });
    const result = await validator.validate({ config: ["a", "b", "c", "d"], provenance: [] });
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      { code: "type", severity: "error", path: [0] },
      { code: "type", severity: "error", path: [1] },
      { code: "ajv_issues_truncated", severity: "error" }
    ]);
  });

  it.each([1, undefined])("reserves the final slot for truncation at budget %s", async maxIssues => {
    const validator = createAjvValidator({ schema: { type: "array", items: { type: "number" } },
      options: { allErrors: true }, ...(maxIssues === undefined ? {} : { maxIssues }) });
    const result = await validator.validate({ config: Array.from({ length: 201 }, () => "invalid"), provenance: [] });
    expect(result.issues).toHaveLength(maxIssues ?? 200);
    expect(result.issues.at(-1)).toEqual({ code: "ajv_issues_truncated", severity: "error" });
  });

  it.each([false, true])("rejects unsupported asynchronous schemas before execution (custom Ajv: %s)", (customAjv) => {
    expect(() => createAjvValidator({
      // @ts-expect-error JavaScript callers can bypass the synchronous Schema contract.
      schema: { $async: true, type: "object" },
      ...(customAjv ? { ajv: new Ajv() } : {})
    })).toThrow("Asynchronous Ajv schemas are not supported by this adapter.");
  });

  it("keeps synchronous schema results synchronous", () => {
    const validator = createAjvValidator({ schema: { type: "object" } });
    const result = validator.validate({ config: {}, provenance: [] });
    expect(result).not.toBeInstanceOf(Promise);
    expect(result).toEqual({ ok: true, value: {}, issues: [] });
  });

  it.each(["type", "required"])("preserves empty property names in %s diagnostics and redaction", async (keyword) => {
    const path = keyword === "type" ? [""] : ["", "password"];
    const result = resolveConfig({ sources: [{
      descriptor: {
        id: "defaults", kind: "object", priority: 0, displayName: "defaults",
        redaction: { secretPaths: [path] }
      },
      value: { "": keyword === "type" ? "fixture-value" : {} }
    }] });
    const validator = createAjvValidator({ schema: {
      type: "object",
      properties: { "": keyword === "type" ? { type: "number" } : {
        type: "object", required: ["password"]
      } }
    } });
    const validation = await runValidators({
      config: result.config, provenance: result.provenance, validators: [validator]
    });
    expect(validation.issues).toEqual([expect.objectContaining({ code: keyword, path })]);
    const report = buildDiagnosticReport({ ...result, ok: false, issues: validation.issues });
    expect(report.issues[0]?.message).toBe(
      "Diagnostic message redacted because it is associated with a secret path or source."
    );
  });

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
  it("distinguishes the root from empty property names", () => {
    expect(instancePathToConfigPath("")).toEqual([]);
    expect(instancePathToConfigPath("/")).toEqual([""]);
    expect(instancePathToConfigPath("//")).toEqual(["", ""]);
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
