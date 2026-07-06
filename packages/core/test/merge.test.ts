import { describe, expect, it } from "vitest";
import {
  buildDiagnosticReport,
  createMappedOverrideSource,
  getConfigValueAtPath,
  loadConfigSources,
  runValidators,
  resolveConfig
} from "../src/index.js";
import type { ConfigLoader, LoadedSource } from "../src/index.js";

function source(id: string, priority: number, value: unknown): LoadedSource {
  return {
    descriptor: {
      id,
      kind: "object",
      priority,
      displayName: id
    },
    value
  };
}

describe("resolveConfig", () => {
  it("deep merges objects and lets higher priority values win", () => {
    const result = resolveConfig({
      sources: [
        source("defaults", 0, {
          server: {
            host: "127.0.0.1",
            port: 3000,
            tags: ["default"],
            nullable: "value"
          }
        }),
        source("env", 10, {
          server: {
            port: 8080,
            tags: ["env"],
            nullable: null
          }
        })
      ]
    });

    expect(result.ok).toBe(true);
    expect(result.config).toEqual({
      server: {
        host: "127.0.0.1",
        port: 8080,
        tags: ["env"],
        nullable: null
      }
    });
    expect(getConfigValueAtPath(result.config, ["server", "port"])).toBe(8080);
    expect(result.resolvedPaths).toContainEqual({
      path: ["server", "port"],
      status: "resolved",
      winningSourceId: "env",
      winningPriority: 10,
      overriddenSourceIds: ["defaults"]
    });
    expect(result.provenance).toContainEqual({
      path: ["server", "port"],
      action: "overridden",
      sourceId: "env",
      previousSourceId: "defaults",
      message: "Source env overrode source defaults."
    });
  });

  it("reports same-priority conflicts without hiding the winning source", () => {
    const result = resolveConfig({
      sources: [
        source("left", 1, { server: { port: 3000 } }),
        source("right", 1, { server: { port: 4000 } })
      ]
    });

    expect(result.ok).toBe(false);
    expect(getConfigValueAtPath(result.config, ["server", "port"])).toBe(4000);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        category: "merge",
        code: "same_priority_conflict",
        path: ["server", "port"],
        sourceId: "right"
      })
    );
  });

  it("rejects unsafe keys before they can mutate object prototypes", () => {
    const malicious = JSON.parse('{"__proto__":{"polluted":true},"safe":true}') as unknown;
    const result = resolveConfig({
      sources: [source("malicious", 1, malicious)]
    });

    expect(result.ok).toBe(false);
    expect(result.config).toEqual({});
    expect(Object.prototype).not.toHaveProperty("polluted");
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        category: "merge",
        code: "unsafe_key",
        path: ["__proto__"],
        sourceId: "malicious"
      })
    );
  });

  it("bounds resource-limit failures", () => {
    const result = resolveConfig({
      sources: [source("too-deep", 1, { a: { b: { c: true } } })],
      limits: {
        maxDepth: 1
      }
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        category: "resource-limit",
        code: "max_depth_exceeded",
        path: ["a", "b"]
      })
    );
  });

  it("applies declared override mappings without inferring names", () => {
    const mapped = createMappedOverrideSource({
      descriptor: {
        id: "env",
        kind: "process-env",
        priority: 10,
        displayName: "env"
      },
      values: {
        APP_PORT: "8080",
        UNMAPPED_VALUE: "ignored"
      },
      mappings: [
        {
          externalName: "APP_PORT",
          sourceKind: "process-env",
          targetPath: ["server", "port"],
          parseAs: "number"
        }
      ]
    });

    const result = resolveConfig({
      sources: [source("defaults", 0, { server: { host: "127.0.0.1" } }), mapped]
    });

    expect(result.ok).toBe(true);
    expect(result.config).toEqual({
      server: {
        host: "127.0.0.1",
        port: 8080
      }
    });
    expect(getConfigValueAtPath(result.config, ["UNMAPPED_VALUE"])).toBeUndefined();
  });

  it("applies opt-in coercion rules and records provenance", () => {
    const result = resolveConfig({
      sources: [source("env", 10, { server: { port: "8080" } })],
      coercionRules: [
        {
          path: ["server", "port"],
          from: "string",
          to: "number",
          onFailure: "issue"
        }
      ]
    });

    expect(result.ok).toBe(true);
    expect(getConfigValueAtPath(result.config, ["server", "port"])).toBe(8080);
    expect(result.provenance).toContainEqual({
      path: ["server", "port"],
      action: "coerced",
      sourceId: "core:coercion",
      message: "Path was coerced from string to number."
    });
  });

  it("normalizes validator failures into config issues", async () => {
    const result = resolveConfig({
      sources: [source("defaults", 0, { server: { port: 3000 } })]
    });
    const validation = await runValidators({
      config: result.config,
      provenance: result.provenance,
      validators: [
        {
          id: "throws",
          validate() {
            throw new Error("validator exploded");
          }
        }
      ]
    });

    expect(validation.issues).toContainEqual({
      category: "validation",
      code: "validator_threw",
      severity: "error",
      sourceId: "throws",
      message: "validator exploded"
    });
    expect(validation.provenance).toContainEqual({
      path: [],
      action: "validated",
      sourceId: "throws",
      message: "Validator throws failed."
    });
  });
});

describe("loadConfigSources", () => {
  it("loads source adapters into merge-ready sources", async () => {
    const loaders: readonly ConfigLoader<{ readonly port: number }>[] = [
      {
        descriptor: {
          id: "defaults",
          kind: "adapter",
          priority: 0,
          displayName: "defaults"
        },
        load(context) {
          return {
            value: {
              server: {
                port: context.port
              }
            }
          };
        }
      }
    ];
    const loaded = await loadConfigSources({
      loaders,
      context: {
        port: 3000
      }
    });
    const result = resolveConfig({
      sources: loaded.sources
    });

    expect(loaded.issues).toEqual([]);
    expect(result.ok).toBe(true);
    expect(getConfigValueAtPath(result.config, ["server", "port"])).toBe(3000);
  });

  it("normalizes loader exceptions into source-load issues", async () => {
    const loaders: readonly ConfigLoader[] = [
      {
        descriptor: {
          id: "broken-loader",
          kind: "adapter",
          priority: 0,
          displayName: "broken-loader"
        },
        load() {
          throw new Error("adapter exploded");
        }
      }
    ];
    const loaded = await loadConfigSources({
      loaders,
      context: undefined
    });
    const result = resolveConfig({
      sources: loaded.sources
    });
    const report = buildDiagnosticReport(result);

    expect(loaded.issues).toContainEqual({
      category: "source-load",
      code: "loader_threw",
      severity: "error",
      sourceId: "broken-loader",
      message: "adapter exploded"
    });
    expect(result.ok).toBe(false);
    expect(report.sources).toContainEqual({
      id: "broken-loader",
      kind: "adapter",
      displayName: "broken-loader",
      priority: 0,
      status: "failed"
    });
  });
});

describe("buildDiagnosticReport", () => {
  it("does not include raw secret values in diagnostic report structures", () => {
    const result = resolveConfig({
      sources: [
        {
          descriptor: {
            id: "env",
            kind: "object",
            priority: 10,
            displayName: "env",
            redaction: {
              secretPaths: [["database", "password"]]
            }
          },
          value: {
            database: {
              password: "example-secret-value",
              host: "db.internal"
            }
          }
        }
      ]
    });

    const report = buildDiagnosticReport(result);
    const reportText = JSON.stringify(report);

    expect(report.resolvedPaths).toContainEqual({
      path: ["database", "password"],
      status: "resolved",
      winningSourceId: "env",
      overriddenSourceIds: [],
      redacted: true,
      redactionReason: "secret-path"
    });
    expect(reportText).not.toContain("example-secret-value");
    expect(reportText).not.toContain("db.internal");
  });
});
