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
import type { ConfigLoader, LoadedSource, ValidatorResult } from "../src/index.js";

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
