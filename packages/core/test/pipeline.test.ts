import { describe, expect, it } from "vitest";
import {
  getConfigValueAtPath,
  runConfigPipeline
} from "../src/index.js";
import type {
  ConfigLoader,
  ConfigValue,
  ValidatorAdapter
} from "../src/index.js";

function loader(
  id: string,
  priority: number,
  value: unknown,
  issues: Awaited<ReturnType<ConfigLoader["load"]>>["issues"] = []
): ConfigLoader {
  return {
    descriptor: {
      id,
      kind: "object",
      priority,
      displayName: id
    },
    load() {
      return { value, issues };
    }
  };
}

describe("runConfigPipeline", () => {
  it("keeps coercion provenance stable when a validator reuses a rule path", async () => {
    const path = ["auth", "token"];
    const pipeline = await runConfigPipeline({
      loaders: [loader("defaults", 0, { auth: { token: "42" } })],
      context: undefined,
      coercionRules: [{ path, from: "string", to: "number", onFailure: "issue" }],
      validators: [{ id: "reuses-rule", validate() {
        path.splice(0, path.length, "server", "port");
        return { ok: true, issues: [] };
      } }]
    });

    expect(pipeline.result.ok).toBe(true);
    expect(pipeline.result.config).toEqual({ auth: { token: 42 } });
    expect(pipeline.result.provenance.find((event) => event.action === "coerced")?.path).toEqual(["auth", "token"]);
    expect(pipeline.report.provenance).toContainEqual(expect.objectContaining({
      action: "coerced", path: ["auth", "token"],
      message: "Provenance message redacted because it is associated with a secret path or source."
    }));
    expect(path).toEqual(["server", "port"]);
  });

  it("keeps validator issue paths stable when later adapters reuse the original array", async () => {
    const path = ["auth", "password"];
    const pipeline = await runConfigPipeline({
      loaders: [loader("defaults", 0, { auth: { password: "" }, server: { port: 3000 } })],
      context: undefined,
      validators: [
        { id: "auth-check", validate: () => ({
          ok: false, issues: [{ code: "required", severity: "error", path }]
        }) },
        { id: "reuses-path", async validate() {
          path.splice(0, path.length, "server", "port");
          return { ok: true, issues: [] };
        } }
      ]
    });

    expect(path).toEqual(["server", "port"]);
    expect(Object.isFrozen(path)).toBe(false);
    expect(pipeline.result.issues[0]?.path).toEqual(["auth", "password"]);
    expect(pipeline.result.issues[0]?.path).not.toBe(path);
    expect(pipeline.report.issues[0]).toEqual(expect.objectContaining({
      path: ["auth", "password"],
      message: "Diagnostic message redacted because it is associated with a secret path or source."
    }));
    path.length = 0;
    expect(pipeline.result.issues[0]?.path).toEqual(["auth", "password"]);
    expect(pipeline.report.issues[0]?.path).toEqual(["auth", "password"]);
  });

  it.each([1, 2, 200])("retains loading preflight failures at diagnostic cap %i", async (maxDiagnostics) => {
    let loaderCalls = 0;
    let validatorCalls = 0;
    const loaders = ["first", "second"].map((id) => ({
      ...loader(id, 0, {}),
      load() {
        loaderCalls += 1;
        return { value: {} };
      }
    }));
    const pipeline = await runConfigPipeline({
      loaders,
      context: undefined,
      limits: { maxSources: 1, maxDiagnostics },
      validators: [{ id: "should-not-run", validate() {
        validatorCalls += 1;
        return { ok: true, issues: [] };
      } }]
    });

    expect(pipeline.result.ok).toBe(false);
    expect(pipeline.result.issues).toEqual([{
      category: "resource-limit",
      code: "max_sources_exceeded",
      severity: "error",
      message: "Source count exceeded the maximum of 1."
    }]);
    expect(pipeline.result.config).toEqual({});
    expect(pipeline.result.sources).toEqual([]);
    expect(pipeline.result.provenance).toEqual([]);
    expect(pipeline.report.status).toBe("error");
    expect(pipeline.report.issues).toEqual(pipeline.result.issues);
    expect(loaderCalls).toBe(0);
    expect(validatorCalls).toBe(0);
  });

  it("accepts the source-count boundary without duplicating loader warnings", async () => {
    const pipeline = await runConfigPipeline({
      loaders: [loader("first", 0, { port: 3000 }, [{
        category: "source-load", code: "source_warning", severity: "warning",
        message: "Source warning."
      }]), loader("second", 1, {})],
      context: undefined,
      limits: { maxSources: 2, maxDiagnostics: 1 }
    });

    expect(pipeline.result.ok).toBe(true);
    expect(pipeline.result.config).toEqual({ port: 3000 });
    expect(pipeline.result.issues).toEqual([expect.objectContaining({ code: "source_warning" })]);
    expect(pipeline.report.status).toBe("ok");
  });

  it.each(["array", "object"])("validates deeply nested %s config without overflowing input freezing", async (kind) => {
    let value: ConfigValue = true;
    for (let depth = 0; depth < 6_000; depth += 1) value = kind === "array" ? [value] : { child: value };
    let inspectedContainers = 0;
    const pipeline = await runConfigPipeline({
      loaders: [loader("deep", 0, { payload: value })], context: undefined,
      limits: { maxDepth: 6_001, maxPathLength: 6_001 },
      validators: [{ id: "frozen-check", validate(input) {
        expect(Object.isFrozen(input.config)).toBe(true);
        let current = getConfigValueAtPath(input.config, ["payload"]);
        while (current !== null && typeof current === "object") {
          expect(Object.isFrozen(current)).toBe(true);
          inspectedContainers += 1;
          current = Array.isArray(current) ? current[0] : Object.values(current)[0];
        }
        expect(current).toBe(true);
        return { ok: true, issues: [] };
      } }]
    });
    expect(pipeline.result.issues).toEqual([]);
    expect(pipeline.result.ok).toBe(true);
    expect(pipeline.report.status).toBe("ok");
    expect(inspectedContainers).toBe(6_000);
    expect(Object.isFrozen(value)).toBe(false);
    expect(Object.isFrozen(pipeline.result.config)).toBe(false);
  });

  it("loads, resolves, validates, and reports through one public facade", async () => {
    const pipeline = await runConfigPipeline({
      loaders: [
        loader("defaults", 0, { service: { port: 3000 } }),
        loader("local", 10, { service: { port: 8080 } })
      ],
      context: undefined,
      validators: [
        {
          id: "port-check",
          validate(input) {
            return {
              ok: getConfigValueAtPath(input.config, ["service", "port"]) === 8080,
              issues: []
            };
          }
        }
      ]
    });

    expect(pipeline.result.ok).toBe(true);
    expect(getConfigValueAtPath(pipeline.result.config, ["service", "port"])).toBe(8080);
    expect(pipeline.result.provenance).toContainEqual({
      path: [],
      action: "validated",
      sourceId: "port-check",
      message: "Validator port-check completed with status ok."
    });
    expect(pipeline.report.status).toBe("ok");
    expect(pipeline.report.resolvedPaths).toContainEqual(
      expect.objectContaining({
        path: ["service", "port"],
        winningSourceId: "local"
      })
    );
  });

  it("returns loader failures as data and skips validators for a failed resolution", async () => {
    let validatorCalled = false;
    const throwingLoader: ConfigLoader = {
      descriptor: {
        id: "broken",
        kind: "adapter",
        priority: 0,
        displayName: "broken"
      },
      load() {
        throw new Error("loader failed with pipeline-loader-secret-value");
      }
    };
    const validator: ValidatorAdapter = {
      id: "should-not-run",
      validate() {
        validatorCalled = true;
        return { ok: true, issues: [] };
      }
    };

    const pipeline = await runConfigPipeline({
      loaders: [throwingLoader],
      context: undefined,
      validators: [validator]
    });

    expect(pipeline.result.ok).toBe(false);
    expect(pipeline.result.issues).toContainEqual(
      expect.objectContaining({
        category: "source-load",
        code: "loader_threw",
        sourceId: "broken"
      })
    );
    expect(validatorCalled).toBe(false);
    expect(pipeline.report.status).toBe("error");
    expect(JSON.stringify(pipeline)).not.toContain("pipeline-loader-secret-value");
  });

  it("returns malformed loader results as data instead of rejecting", async () => {
    const malformedLoader = {
      descriptor: {
        id: "malformed",
        kind: "adapter" as const,
        priority: 0,
        displayName: "malformed"
      },
      load() {
        return { value: {}, issues: [null] } as unknown as Awaited<ReturnType<ConfigLoader["load"]>>;
      }
    };

    const pipeline = await runConfigPipeline({
      loaders: [malformedLoader],
      context: undefined
    });

    expect(pipeline.result.ok).toBe(false);
    expect(pipeline.result.issues).toContainEqual(
      expect.objectContaining({
        category: "source-load",
        code: "invalid_loader_result",
        sourceId: "malformed"
      })
    );
    expect(pipeline.report.status).toBe("error");
  });

  it("returns hostile loader values as data instead of rejecting", async () => {
    const value = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("pipeline-source-value-secret-text");
        }
      }
    );
    const pipeline = await runConfigPipeline({
      loaders: [loader("hostile", 0, value)],
      context: undefined
    });

    expect(pipeline.result.ok).toBe(false);
    expect(pipeline.result.issues).toContainEqual(
      expect.objectContaining({
        category: "parse",
        code: "source_value_inspection_failed",
        sourceId: "hostile"
      })
    );
    expect(pipeline.report.status).toBe("error");
    expect(JSON.stringify(pipeline)).not.toContain("pipeline-source-value-secret-text");
  });

  it("keeps combined resolution and validation diagnostics within maxDiagnostics", async () => {
    const pipeline = await runConfigPipeline({
      loaders: [
        loader(
          "warnings",
          0,
          { service: { port: 3000 } },
          [
            {
              category: "source-load",
              code: "source_warning",
              severity: "warning",
              sourceId: "warnings",
              message: "Source warning."
            }
          ]
        )
      ],
      context: undefined,
      limits: {
        maxDiagnostics: 2
      },
      validators: [
        {
          id: "many-issues",
          validate() {
            return {
              ok: false,
              issues: [
                {
                  category: "validation",
                  code: "first",
                  severity: "error",
                  path: ["service", "port"],
                  message: "First validation failure."
                },
                {
                  category: "validation",
                  code: "second",
                  severity: "error",
                  path: ["service", "port"],
                  message: "Second validation failure."
                }
              ]
            };
          }
        }
      ]
    });

    expect(pipeline.result.issues).toEqual([
      expect.objectContaining({
        code: "source_warning"
      }),
      {
        category: "resource-limit",
        code: "max_diagnostics_exceeded",
        severity: "error",
        message: "Diagnostics exceeded the maximum of 2."
      }
    ]);
    expect(pipeline.report.issues).toHaveLength(2);
  });

  it("applies maxDiagnostics while retaining loader output", async () => {
    const pipeline = await runConfigPipeline({
      loaders: [
        loader(
          "noisy",
          0,
          {},
          ["first", "second", "third"].map((code) => ({
            category: "source-load",
            code,
            severity: "warning",
            sourceId: "noisy",
            message: `${code} issue.`
          }))
        )
      ],
      context: undefined,
      limits: { maxDiagnostics: 2 }
    });

    expect(pipeline.result.issues).toHaveLength(2);
    expect(pipeline.result.issues.at(-1)).toEqual(
      expect.objectContaining({
        category: "resource-limit",
        code: "max_diagnostics_exceeded"
      })
    );
  });
});
