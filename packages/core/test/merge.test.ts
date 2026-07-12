import { describe, expect, it } from "vitest";
import {
  buildDiagnosticReport,
  createMappedOverrideSource,
  getConfigValueAtPath,
  loadConfigSources,
  runValidators,
  resolveConfig,
  setConfigValueAtPath
} from "../src/index.js";
import type { ConfigLoader, ConfigLoaderResult, LoadedSource, ValidatorResult } from "../src/index.js";

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
  it("accepts shared object references that do not form a cycle", () => {
    const shared = { enabled: true };
    const result = resolveConfig({
      sources: [source("shared", 0, { left: shared, right: shared })]
    });

    expect(result.ok).toBe(true);
    expect(result.config).toEqual({
      left: { enabled: true },
      right: { enabled: true }
    });
    expect(result.issues).not.toContainEqual(expect.objectContaining({ code: "cyclic_value" }));
  });

  it("still rejects actual cyclic source values", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const result = resolveConfig({
      sources: [source("cyclic", 0, cyclic)]
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "cyclic_value" }));
  });

  it("applies key limits to the aggregate resolved config", () => {
    const result = resolveConfig({
      sources: [
        source("first", 0, { first: 1, second: 2 }),
        source("second", 1, { third: 3, fourth: 4 })
      ],
      limits: { maxKeyCount: 2 }
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        category: "resource-limit",
        code: "max_key_count_exceeded",
        sourceId: "core:resolved-config"
      })
    );
  });

  it("applies structure limits after JSON coercion", () => {
    const payload = Object.fromEntries(Array.from({ length: 4 }, (_, index) => [`key${index}`, index]));
    const result = resolveConfig({
      sources: [source("json", 0, { payload: JSON.stringify(payload) })],
      coercionRules: [
        {
          path: ["payload"],
          from: "string",
          to: "json",
          onFailure: "issue"
        }
      ],
      limits: { maxKeyCount: 2 }
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        category: "resource-limit",
        code: "max_key_count_exceeded",
        sourceId: "core:resolved-config"
      })
    );
  });

  it("falls back to bounded defaults for invalid runtime resource limits", () => {
    const result = resolveConfig({
      sources: [source("defaults", 0, { enabled: true })],
      limits: {
        maxDepth: Number.NaN,
        maxKeyCount: Number.POSITIVE_INFINITY,
        maxPathLength: 0,
        maxDiagnostics: Number.MAX_SAFE_INTEGER + 1
      }
    });

    expect(result.ok).toBe(true);
    expect(result.limits).toEqual({
      maxDepth: 32,
      maxKeyCount: 10_000,
      maxPathLength: 32,
      maxDiagnostics: 200
    });
  });

  it("converts source value inspection exceptions into parse issues", () => {
    const value = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("source-value-secret-text");
        }
      }
    );
    const result = resolveConfig({
      sources: [source("hostile", 0, value)]
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      {
        category: "parse",
        code: "source_value_inspection_failed",
        severity: "error",
        sourceId: "hostile",
        message: "Failed to inspect normalized source value. Exception details were omitted from diagnostics."
      }
    ]);
    expect(JSON.stringify(result)).not.toContain("source-value-secret-text");
  });

  it("rejects duplicate source ids before merge", () => {
    const result = resolveConfig({
      sources: [
        {
          ...source("duplicate", 0, { database: { password: "duplicate-source-secret" } }),
          descriptor: {
            ...source("duplicate", 0, {}).descriptor,
            redaction: { secretSource: true }
          },
          issues: [
            {
              category: "source-load",
              code: "secret_warning",
              severity: "warning",
              sourceId: "duplicate",
              message: "duplicate-source-secret"
            }
          ]
        },
        source("duplicate", 1, { public: true })
      ]
    });
    const report = buildDiagnosticReport(result);

    expect(result.ok).toBe(false);
    expect(result.config).toEqual({});
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        category: "source-load",
        code: "duplicate_source_id",
        sourceId: "duplicate"
      })
    );
    expect(JSON.stringify(report)).not.toContain("duplicate-source-secret");
  });

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

  it("rejects unsafe public path writes before they can mutate object prototypes", () => {
    expect(() => setConfigValueAtPath({}, ["__proto__", "polluted"], true)).toThrow(/Unsafe config path segment/);
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it("removes stale child resolved paths when a parent value replaces an object shape", () => {
    const result = resolveConfig({
      sources: [
        source("defaults", 0, {
          server: {
            port: 3000
          }
        }),
        source("env", 10, {
          server: "disabled"
        })
      ]
    });

    expect(result.ok).toBe(true);
    expect(result.config).toEqual({
      server: "disabled"
    });
    expect(result.resolvedPaths).toContainEqual(
      expect.objectContaining({
        path: ["server"],
        winningSourceId: "env",
        overriddenSourceIds: ["defaults"]
      })
    );
    expect(result.resolvedPaths).not.toContainEqual(
      expect.objectContaining({
        path: ["server", "port"]
      })
    );
  });

  it("replaces all descendant resolved paths when a parent value wins", () => {
    const result = resolveConfig({
      sources: [
        source("defaults", 0, {
          server: {
            host: "127.0.0.1",
            port: 3000
          }
        }),
        source("site", 1, {
          server: {
            tls: true
          }
        }),
        source("env", 10, {
          server: "disabled"
        })
      ]
    });

    expect(result.ok).toBe(true);
    expect(result.config).toEqual({
      server: "disabled"
    });
    expect(result.resolvedPaths).toContainEqual(
      expect.objectContaining({
        path: ["server"],
        winningSourceId: "env",
        overriddenSourceIds: ["defaults", "site"]
      })
    );
    expect(result.resolvedPaths).not.toContainEqual(
      expect.objectContaining({
        path: ["server", "host"]
      })
    );
    expect(result.resolvedPaths).not.toContainEqual(
      expect.objectContaining({
        path: ["server", "port"]
      })
    );
    expect(result.resolvedPaths).not.toContainEqual(
      expect.objectContaining({
        path: ["server", "tls"]
      })
    );
  });

  it("removes stale parent resolved paths when a child path replaces a scalar shape", () => {
    const result = resolveConfig({
      sources: [
        source("defaults", 0, {
          server: "disabled"
        }),
        source("env", 10, {
          server: {
            port: 8080
          }
        })
      ]
    });

    expect(result.ok).toBe(true);
    expect(result.config).toEqual({
      server: {
        port: 8080
      }
    });
    expect(result.resolvedPaths).toContainEqual(
      expect.objectContaining({
        path: ["server", "port"],
        winningSourceId: "env",
        overriddenSourceIds: ["defaults"]
      })
    );
    expect(result.resolvedPaths).not.toContainEqual(
      expect.objectContaining({
        path: ["server"]
      })
    );
  });

  it("preserves explicitly declared empty object values", () => {
    const result = resolveConfig({
      sources: [source("defaults", 0, { plugins: {} })]
    });

    expect(result.ok).toBe(true);
    expect(result.config).toEqual({ plugins: {} });
    expect(getConfigValueAtPath(result.config, ["plugins"])).toEqual({});
    expect(result.resolvedPaths).toContainEqual(
      expect.objectContaining({
        path: ["plugins"],
        winningSourceId: "defaults"
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

  it("marks diagnostics when source issues are truncated", () => {
    const result = resolveConfig({
      sources: [
        {
          descriptor: {
            id: "adapter",
            kind: "adapter",
            priority: 0,
            displayName: "adapter"
          },
          value: {},
          issues: [
            {
              category: "source-load",
              code: "first",
              severity: "error",
              sourceId: "adapter",
              message: "first issue"
            },
            {
              category: "source-load",
              code: "second",
              severity: "error",
              sourceId: "adapter",
              message: "second issue"
            },
            {
              category: "source-load",
              code: "third",
              severity: "error",
              sourceId: "adapter",
              message: "third issue"
            }
          ]
        }
      ],
      limits: {
        maxDiagnostics: 2
      }
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(2);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        category: "resource-limit",
        code: "max_diagnostics_exceeded"
      })
    );
  });

  it("keeps merge-generated diagnostics and the overflow marker within the declared limit", () => {
    const result = resolveConfig({
      sources: [
        source("left", 1, { first: 1, second: 2, third: 3 }),
        source("right", 1, { first: 10, second: 20, third: 30 })
      ],
      limits: {
        maxDiagnostics: 2
      }
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({
        category: "merge",
        code: "same_priority_conflict",
        path: ["first"]
      }),
      {
        category: "resource-limit",
        code: "max_diagnostics_exceeded",
        severity: "error",
        message: "Diagnostics exceeded the maximum of 2."
      }
    ]);
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

  it.each([
    {
      name: "child before parent",
      mappings: [
        {
          externalName: "PORT",
          sourceKind: "process-env" as const,
          targetPath: ["service", "port"],
          parseAs: "number" as const
        },
        {
          externalName: "SERVICE",
          sourceKind: "process-env" as const,
          targetPath: ["service"],
          parseAs: "json" as const
        }
      ]
    },
    {
      name: "parent before child",
      mappings: [
        {
          externalName: "SERVICE",
          sourceKind: "process-env" as const,
          targetPath: ["service"],
          parseAs: "json" as const
        },
        {
          externalName: "PORT",
          sourceKind: "process-env" as const,
          targetPath: ["service", "port"],
          parseAs: "number" as const
        }
      ]
    }
  ])("rejects overlapping mapping target paths with $name", ({ mappings }) => {
    const mapped = createMappedOverrideSource({
      descriptor: {
        id: "env",
        kind: "process-env",
        priority: 10,
        displayName: "env"
      },
      values: {
        PORT: "3000",
        SERVICE: '{"host":"api.internal"}'
      },
      mappings
    });
    const result = resolveConfig({ sources: [mapped] });

    expect(mapped.issues).toContainEqual(
      expect.objectContaining({
        category: "mapping",
        code: "overlapping_mapping_target_path",
        sourceId: "env"
      })
    );
    expect(result.ok).toBe(false);
    expect(result.config).toEqual({});
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

  it("rejects non-finite JSON coercion results", () => {
    const result = resolveConfig({
      sources: [source("env", 10, { threshold: "1e999" })],
      coercionRules: [
        {
          path: ["threshold"],
          from: "string",
          to: "json",
          onFailure: "issue"
        }
      ]
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        category: "coercion",
        code: "coercion_failed",
        path: ["threshold"],
        message: "Expected JSON-compatible value."
      })
    );
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
            throw new Error("validator exploded with example-secret-value");
          }
        }
      ]
    });

    expect(validation.issues).toContainEqual({
      category: "validation",
      code: "validator_threw",
      severity: "error",
      sourceId: "throws",
      message: "Validator throws threw an exception. Exception details were omitted from diagnostics."
    });
    expect(JSON.stringify(validation)).not.toContain("example-secret-value");
    expect(validation.provenance).toContainEqual({
      path: [],
      action: "validated",
      sourceId: "throws",
      message: "Validator throws failed."
    });
  });

  it("ignores untrusted validator message, details, and source identity", async () => {
    const result = resolveConfig({
      sources: [source("defaults", 0, { database: { password: "example-secret-value" } })]
    });
    const validation = await runValidators({
      config: result.config,
      provenance: result.provenance,
      validators: [
        {
          id: "root-check",
          validate() {
            return {
              ok: false,
              issues: [
                {
                  category: "validation",
                  code: "root_invalid",
                  severity: "error",
                  path: ["database", "password"],
                  sourceId: "spoofed-validator",
                  message: "Rejected example-secret-value.",
                  details: {
                    received: "example-secret-value"
                  }
                }
              ]
            };
          }
        }
      ]
    });

    expect(validation.issues).toEqual([
      {
        category: "validation",
        code: "root_invalid",
        severity: "error",
        path: ["database", "password"],
        sourceId: "root-check",
        message: "Validator root-check reported validation issue root_invalid."
      }
    ]);
    expect(JSON.stringify(validation)).not.toContain("example-secret-value");
  });

  it("rejects validator issue codes that can carry free-form diagnostic text", async () => {
    const result = resolveConfig({
      sources: [source("defaults", 0, { server: { port: 3000 } })]
    });
    const validation = await runValidators({
      config: result.config,
      provenance: result.provenance,
      validators: [
        {
          id: "malicious-code",
          validate() {
            return {
              ok: false,
              issues: [
                {
                  code: "token=validator-secret-value",
                  severity: "error",
                  path: ["server", "port"]
                }
              ]
            };
          }
        }
      ]
    });

    expect(validation.issues).toEqual([
      {
        category: "validation",
        code: "validator_issue_invalid",
        severity: "error",
        sourceId: "malicious-code",
        message: "Validator malicious-code returned invalid issue at index 0."
      }
    ]);
    expect(JSON.stringify(validation)).not.toContain("validator-secret-value");
  });

  it("does not apply validator returned values to the pipeline config", async () => {
    const result = resolveConfig({
      sources: [source("defaults", 0, { server: { port: 3000 } })]
    });
    const observedPorts: unknown[] = [];
    const validation = await runValidators({
      config: result.config,
      provenance: result.provenance,
      validators: [
        {
          id: "typed-output",
          validate() {
            return {
              ok: true,
              value: {
                server: {
                  port: 9000
                }
              },
              issues: []
            };
          }
        },
        {
          id: "observer",
          validate(input) {
            observedPorts.push(getConfigValueAtPath(input.config, ["server", "port"]));
            return {
              ok: true,
              value: input.config,
              issues: []
            };
          }
        }
      ]
    });

    expect(validation.issues).toEqual([]);
    expect(observedPorts).toEqual([3000]);
    expect(getConfigValueAtPath(result.config, ["server", "port"])).toBe(3000);
    expect(validation.provenance).toContainEqual({
      path: [],
      action: "validated",
      sourceId: "typed-output",
      message: "Validator typed-output completed with status ok."
    });
  });

  it("blocks validators from mutating the pipeline config object", async () => {
    const result = resolveConfig({
      sources: [source("defaults", 0, { server: { port: 3000 } })]
    });
    const validation = await runValidators({
      config: result.config,
      provenance: result.provenance,
      validators: [
        {
          id: "mutating-validator",
          validate(input) {
            (getConfigValueAtPath(input.config, ["server"]) as { port: number }).port = 9000;
            return {
              ok: true,
              value: input.config,
              issues: []
            };
          }
        }
      ]
    });

    expect(validation.issues).toContainEqual(
      expect.objectContaining({
        category: "validation",
        code: "validator_threw",
        sourceId: "mutating-validator"
      })
    );
    expect(getConfigValueAtPath(result.config, ["server", "port"])).toBe(3000);
  });

  it("blocks validators from mutating pipeline provenance", async () => {
    const result = resolveConfig({
      sources: [source("defaults", 0, { public: true })]
    });
    const originalProvenance = structuredClone(result.provenance);
    const validation = await runValidators({
      config: result.config,
      provenance: result.provenance,
      validators: [
        {
          id: "mutating-provenance",
          validate(input) {
            (input.provenance[0] as { message: string }).message = "validator-provenance-secret";
            return { ok: true, issues: [] };
          }
        }
      ]
    });

    expect(validation.issues).toContainEqual(
      expect.objectContaining({
        category: "validation",
        code: "validator_threw",
        sourceId: "mutating-provenance"
      })
    );
    expect(result.provenance).toEqual(originalProvenance);
    expect(JSON.stringify({ result, validation })).not.toContain("validator-provenance-secret");
  });

  it("normalizes malformed validator results and issues", async () => {
    const result = resolveConfig({
      sources: [source("defaults", 0, { server: { port: 3000 } })]
    });
    const validation = await runValidators({
      config: result.config,
      provenance: result.provenance,
      validators: [
        {
          id: "malformed-issues",
          validate() {
            return {
              ok: false,
              issues: [
                {
                  category: "validation",
                  code: "custom_failure",
                  severity: "error",
                  path: ["server", "port"],
                  message: "Port failed custom validation."
                },
                {
                  category: "merge",
                  code: "wrong_category",
                  severity: "error",
                  message: "Wrong category."
                },
                "not-an-issue"
              ]
            } as unknown as ValidatorResult;
          }
        },
        {
          id: "malformed-result",
          validate() {
            return {
              ok: false
            } as unknown as ValidatorResult;
          }
        }
      ]
    });

    expect(validation.issues).toContainEqual({
      category: "validation",
      code: "custom_failure",
      severity: "error",
      path: ["server", "port"],
      sourceId: "malformed-issues",
      message: "Validator malformed-issues reported validation issue custom_failure."
    });
    expect(validation.issues).toContainEqual({
      category: "validation",
      code: "validator_issue_invalid",
      severity: "error",
      sourceId: "malformed-issues",
      message: "Validator malformed-issues returned invalid issue at index 1."
    });
    expect(validation.issues).toContainEqual({
      category: "validation",
      code: "validator_issue_invalid",
      severity: "error",
      sourceId: "malformed-issues",
      message: "Validator malformed-issues returned invalid issue at index 2."
    });
    expect(validation.issues).toContainEqual({
      category: "validation",
      code: "validator_result_invalid",
      severity: "error",
      sourceId: "malformed-result",
      message: "Validator malformed-result returned an invalid result."
    });
    expect(validation.provenance).toContainEqual({
      path: [],
      action: "validated",
      sourceId: "malformed-result",
      message: "Validator malformed-result returned an invalid result."
    });
  });

  it("normalizes inconsistent validator status and issue results", async () => {
    const result = resolveConfig({
      sources: [source("defaults", 0, { server: { port: 3000 } })]
    });
    const validation = await runValidators({
      config: result.config,
      provenance: result.provenance,
      validators: [
        {
          id: "false-without-error",
          validate() {
            return {
              ok: false,
              issues: []
            };
          }
        },
        {
          id: "true-with-error",
          validate() {
            return {
              ok: true,
              issues: [
                {
                  category: "validation",
                  code: "custom_error",
                  severity: "error",
                  message: "Validator reported an error issue."
                }
              ]
            };
          }
        }
      ]
    });

    expect(validation.issues).toContainEqual({
      category: "validation",
      code: "validator_failed_without_issues",
      severity: "error",
      sourceId: "false-without-error",
      message: "Validator false-without-error returned ok false without any error issues."
    });
    expect(validation.issues).toContainEqual({
      category: "validation",
      code: "custom_error",
      severity: "error",
      sourceId: "true-with-error",
      message: "Validator true-with-error reported validation issue custom_error."
    });
    expect(validation.provenance).toContainEqual({
      path: [],
      action: "validated",
      sourceId: "false-without-error",
      message: "Validator false-without-error completed with status error."
    });
    expect(validation.provenance).toContainEqual({
      path: [],
      action: "validated",
      sourceId: "true-with-error",
      message: "Validator true-with-error completed with status error."
    });
  });

  it("bounds validator diagnostics with an overflow marker", async () => {
    const result = resolveConfig({
      sources: [source("defaults", 0, { server: { port: 3000 } })]
    });
    const validation = await runValidators({
      config: result.config,
      provenance: result.provenance,
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
                  code: "first_failure",
                  severity: "error",
                  message: "First failure."
                },
                {
                  category: "validation",
                  code: "second_failure",
                  severity: "error",
                  message: "Second failure."
                },
                {
                  category: "validation",
                  code: "third_failure",
                  severity: "error",
                  message: "Third failure."
                }
              ]
            };
          }
        }
      ]
    });

    expect(validation.issues).toEqual([
      {
        category: "validation",
        code: "first_failure",
        severity: "error",
        sourceId: "many-issues",
        message: "Validator many-issues reported validation issue first_failure."
      },
      {
        category: "resource-limit",
        code: "max_diagnostics_exceeded",
        severity: "error",
        message: "Diagnostics exceeded the maximum of 2."
      }
    ]);
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
          throw new Error("adapter exploded with loader-secret-value");
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
      message: "Loader broken-loader threw an exception. Exception details were omitted from diagnostics."
    });
    expect(result.ok).toBe(false);
    expect(JSON.stringify({ loaded, report })).not.toContain("loader-secret-value");
    expect(report.sources).toContainEqual({
      id: "broken-loader",
      kind: "adapter",
      displayName: "broken-loader",
      priority: 0,
      status: "failed"
    });
  });

  it.each([
    {
      name: "non-array issues",
      result: { value: {}, issues: {} }
    },
    {
      name: "malformed issue entries",
      result: { value: {}, issues: [null] }
    },
    {
      name: "malformed locations",
      result: {
        value: {},
        locations: [
          {
            path: ["service"],
            location: { sourceId: "adapter", line: 0 }
          }
        ]
      }
    }
  ])("rejects $name in loader results", async ({ result }) => {
    const loaded = await loadConfigSources({
      loaders: [
        {
          descriptor: {
            id: "invalid-loader",
            kind: "adapter",
            priority: 0,
            displayName: "invalid-loader"
          },
          load() {
            return result as unknown as ConfigLoaderResult;
          }
        }
      ],
      context: undefined
    });

    expect(loaded.sources).toEqual([
      {
        descriptor: expect.objectContaining({ id: "invalid-loader" }),
        value: {},
        issues: [
          {
            category: "source-load",
            code: "invalid_loader_result",
            severity: "error",
            sourceId: "invalid-loader",
            message: "Loader invalid-loader returned an invalid result."
          }
        ]
      }
    ]);
    expect(loaded.issues).toEqual(loaded.sources[0]?.issues);
  });

  it("binds loader issue and location source identity to the descriptor", async () => {
    const loaded = await loadConfigSources({
      loaders: [
        {
          descriptor: {
            id: "owned-source",
            kind: "adapter",
            priority: 0,
            displayName: "owned-source"
          },
          load() {
            return {
              value: {},
              issues: [
                {
                  category: "parse",
                  code: "adapter_parse_failed",
                  severity: "error",
                  sourceId: "spoofed-source",
                  message: "Adapter parse failed."
                }
              ],
              locations: [
                {
                  path: ["service", "port"],
                  location: {
                    sourceId: "spoofed-source",
                    sourcePath: "config.example",
                    line: 2,
                    column: 3
                  }
                }
              ]
            };
          }
        }
      ],
      context: undefined
    });

    expect(loaded.sources[0]?.issues?.[0]?.sourceId).toBe("owned-source");
    expect(loaded.sources[0]?.locations?.[0]?.location.sourceId).toBe("owned-source");
  });

  it("bounds retained source and aggregate loader issues", async () => {
    const loaderIssues = ["first", "second", "third"].map((code) => ({
      category: "source-load" as const,
      code,
      severity: "warning" as const,
      sourceId: "noisy-loader",
      message: `${code} issue.`
    }));
    const loaded = await loadConfigSources({
      loaders: [
        {
          descriptor: {
            id: "noisy-loader",
            kind: "adapter",
            priority: 0,
            displayName: "noisy-loader"
          },
          load() {
            return { value: {}, issues: loaderIssues };
          }
        }
      ],
      context: undefined,
      limits: { maxDiagnostics: 2 }
    });

    expect(loaded.sources[0]?.issues).toEqual([
      expect.objectContaining({ code: "first" }),
      {
        category: "resource-limit",
        code: "max_diagnostics_exceeded",
        severity: "error",
        message: "Diagnostics exceeded the maximum of 2."
      }
    ]);
    expect(loaded.issues).toEqual(loaded.sources[0]?.issues);
  });

  it("keeps invalid loader diagnostic limits bounded by the default", async () => {
    const loaded = await loadConfigSources({
      loaders: [
        {
          descriptor: {
            id: "noisy-loader",
            kind: "adapter",
            priority: 0,
            displayName: "noisy-loader"
          },
          load() {
            return {
              value: {},
              issues: Array.from({ length: 201 }, (_, index) => ({
                category: "source-load" as const,
                code: `issue_${index}`,
                severity: "warning" as const,
                message: "Loader issue."
              }))
            };
          }
        }
      ],
      context: undefined,
      limits: { maxDiagnostics: Number.NaN }
    });

    expect(loaded.issues).toHaveLength(200);
    expect(loaded.issues.at(-1)).toEqual(
      expect.objectContaining({
        category: "resource-limit",
        code: "max_diagnostics_exceeded"
      })
    );
  });
});

describe("buildDiagnosticReport", () => {
  it.each([
    {
      name: "descriptor secret source with a pathless issue",
      redaction: { secretSource: true },
      options: {},
      configPath: ["service", "value"],
      issuePath: undefined,
      reason: "secret-source"
    },
    {
      name: "option secret source with a pathless issue",
      redaction: undefined,
      options: { secretSourceIds: ["defaults"] },
      configPath: ["service", "value"],
      issuePath: undefined,
      reason: "secret-source"
    },
    {
      name: "descriptor parent secret path",
      redaction: { secretPaths: [["service"]] },
      options: {},
      configPath: ["service", "value"],
      issuePath: ["service", "value"],
      reason: "secret-path"
    },
    {
      name: "option secret path",
      redaction: undefined,
      options: { secretPaths: [["service", "value"]] },
      configPath: ["service", "value"],
      issuePath: ["service", "value"],
      reason: "secret-path"
    },
    {
      name: "descriptor custom secret name",
      redaction: { secretNamePatterns: ["private_value"] },
      options: {},
      configPath: ["service", "private_value"],
      issuePath: ["service", "private_value"],
      reason: "secret-name"
    },
    {
      name: "default secret name",
      redaction: undefined,
      options: {},
      configPath: ["service", "access_token"],
      issuePath: ["service", "access_token"],
      reason: "secret-name"
    }
  ])("redacts combined diagnostic fields for $name", ({ redaction, options, configPath, issuePath, reason }) => {
    const secretValue = "matrix-secret-value";
    const result = resolveConfig({
      sources: [
        {
          descriptor: {
            id: "defaults",
            kind: "object",
            priority: 0,
            displayName: "defaults",
            ...(redaction === undefined ? {} : { redaction })
          },
          value: {
            service: {
              [String(configPath[1])]: secretValue
            }
          },
          issues: [
            {
              category: "source-load",
              code: "matrix_source_failure",
              severity: "warning",
              sourceId: "defaults",
              ...(issuePath === undefined ? {} : { path: issuePath }),
              message: `failed while handling ${secretValue}`,
              details: {
                raw: secretValue
              }
            }
          ]
        }
      ]
    });
    const report = buildDiagnosticReport(result, options);
    const reportText = JSON.stringify(report);

    expect(reportText).not.toContain(secretValue);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: "matrix_source_failure",
        message: "Diagnostic message redacted because it is associated with a secret path or source."
      })
    );
    expect(report.resolvedPaths).toContainEqual(
      expect.objectContaining({
        path: configPath,
        redacted: true,
        redactionReason: reason
      })
    );
  });

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

  it("redacts issue and provenance messages associated with secret paths", () => {
    const result = resolveConfig({
      sources: [
        {
          descriptor: {
            id: "defaults",
            kind: "object",
            priority: 0,
            displayName: "defaults",
            redaction: {
              secretPaths: [["database", "password"]]
            }
          },
          value: {
            database: {
              password: "example-secret-value"
            }
          },
          issues: [
            {
              category: "source-load",
              code: "secret_parse_failed",
              severity: "warning",
              sourceId: "defaults",
              path: ["database", "password"],
              message: "failed while handling example-secret-value",
              details: {
                raw: "example-secret-value"
              }
            }
          ]
        }
      ]
    });
    const report = buildDiagnosticReport(result);
    const reportText = JSON.stringify(report);

    expect(reportText).not.toContain("example-secret-value");
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: "secret_parse_failed",
        message: "Diagnostic message redacted because it is associated with a secret path or source."
      })
    );
    expect(report.provenance).toContainEqual(
      expect.objectContaining({
        path: ["database", "password"],
        message: "Provenance message redacted because it is associated with a secret path or source."
      })
    );
  });

  it("redacts descendant paths when a parent secret path is declared", () => {
    const result = resolveConfig({
      sources: [
        {
          descriptor: {
            id: "defaults",
            kind: "object",
            priority: 0,
            displayName: "defaults",
            redaction: {
              secretPaths: [["database"]]
            }
          },
          value: {
            database: {
              clientId: "example-secret-value"
            }
          },
          issues: [
            {
              category: "source-load",
              code: "secret_child_failed",
              severity: "warning",
              sourceId: "defaults",
              path: ["database", "clientId"],
              message: "failed while handling example-secret-value",
              details: {
                raw: "example-secret-value"
              }
            }
          ]
        }
      ]
    });
    const report = buildDiagnosticReport(result);
    const reportText = JSON.stringify(report);

    expect(report.resolvedPaths).toContainEqual(
      expect.objectContaining({
        path: ["database", "clientId"],
        redacted: true,
        redactionReason: "secret-path"
      })
    );
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: "secret_child_failed",
        message: "Diagnostic message redacted because it is associated with a secret path or source."
      })
    );
    expect(reportText).not.toContain("example-secret-value");
  });

  it("keeps default secret-name regex patterns working", () => {
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
            service: {
              "api-key": "example-secret-value"
            }
          }
        }
      ]
    });
    const report = buildDiagnosticReport(result);

    expect(report.resolvedPaths).toContainEqual(
      expect.objectContaining({
        path: ["service", "api-key"],
        redacted: true,
        redactionReason: "secret-name"
      })
    );
  });

  it("falls back to literal matching for risky secret-name patterns", () => {
    const result = resolveConfig({
      sources: [
        {
          descriptor: {
            id: "defaults",
            kind: "object",
            priority: 0,
            displayName: "defaults",
            redaction: {
              secretNamePatterns: ["(a+)+$"]
            }
          },
          value: {
            service: {
              "(a+)+$": "example-secret-value"
            }
          }
        }
      ]
    });
    const report = buildDiagnosticReport(result);

    expect(report.resolvedPaths).toContainEqual(
      expect.objectContaining({
        path: ["service", "(a+)+$"],
        redacted: true,
        redactionReason: "secret-name"
      })
    );
    expect(JSON.stringify(report)).not.toContain("example-secret-value");
  });
});
