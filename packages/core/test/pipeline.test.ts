import { describe, expect, it } from "vitest";
import {
  getConfigValueAtPath,
  runConfigPipeline
} from "../src/index.js";
import type {
  ConfigLoader,
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
