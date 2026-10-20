import { describe, expect, it } from "vitest";
import {
  buildDiagnosticReport,
  createMappedOverrideSource,
  getConfigValueAtPath,
  resolveConfig,
  setConfigValueAtPath
} from "../src/index.js";
import { source } from "./helpers/source.js";

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
        maxDiagnostics: Number.MAX_SAFE_INTEGER + 1,
        maxSources: 0,
        maxProvenanceEvents: Number.NaN,
        maxResolvedPaths: Number.POSITIVE_INFINITY,
        maxReportBytes: 1
      }
    });

    expect(result.ok).toBe(true);
    expect(result.limits).toEqual({
      maxDepth: 32,
      maxKeyCount: 10_000,
      maxPathLength: 32,
      maxDiagnostics: 200,
      maxSources: 64,
      maxProvenanceEvents: 20_000,
      maxResolvedPaths: 10_000,
      maxReportBytes: 4 * 1024 * 1024
    });
  });

  it("bounds source count before resolution", () => {
    const result = resolveConfig({
      sources: [source("one", 0, { one: 1 }), source("two", 1, { two: 2 })],
      limits: { maxSources: 1 }
    });
    expect(result.ok).toBe(false);
    expect(result.sources).toHaveLength(1);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "max_sources_exceeded" }));
  });

  it.each([1, 64, Number.NaN])("rejects excess sources before sorting at limit %s", (maxSources) => {
    const maximum = Number.isNaN(maxSources) ? 64 : maxSources;
    let sourceReads = 0;
    let priorityReads = 0;
    let valueReads = 0;
    const values = Array.from({ length: 10_000 }, (_, index) => ({
      descriptor: { id: `source-${index}`, kind: "object" as const, displayName: `source-${index}`,
        get priority() { priorityReads += 1; return 10_000 - index; } },
      get value() { valueReads += 1; return {}; }
    }));
    const sources = new Proxy(values, { get(target, key, receiver) {
      if (typeof key === "string" && /^(0|[1-9]\d*)$/.test(key)) sourceReads += 1;
      return Reflect.get(target, key, receiver);
    } });
    const result = resolveConfig({ sources, limits: { maxSources } });

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([expect.objectContaining({ code: "max_sources_exceeded" })]);
    expect(sourceReads).toBe(maximum);
    expect(priorityReads).toBe(0);
    expect(valueReads).toBe(0);
    expect(result.sources.map((descriptor) => descriptor.id)).toEqual(
      Array.from({ length: maximum }, (_, index) => `source-${index}`)
    );
    expect(result.config).toEqual({});
    expect(result.provenance).toEqual([]);
    expect(result.resolvedPaths).toEqual([]);
    expect(values[0]?.descriptor.id).toBe("source-0");
  });

  it("preserves priority and stable tie ordering at the exact source-count limit", () => {
    const sources = [source("high", 10, { port: 8080 }), source("low", 0, { port: 3000 }),
      source("tie", 0, { enabled: true })];
    const result = resolveConfig({ sources, limits: { maxSources: 3 } });
    expect(result.ok).toBe(true);
    expect(result.config).toEqual({ port: 8080, enabled: true });
    expect(result.sources.map((descriptor) => descriptor.id)).toEqual(["low", "tie", "high"]);
    expect(sources.map((entry) => entry.descriptor.id)).toEqual(["high", "low", "tie"]);
  });

  it("bounds retained provenance and resolved paths", () => {
    const result = resolveConfig({
      sources: [source("defaults", 0, { one: 1, two: 2, three: 3 })],
      limits: { maxProvenanceEvents: 1, maxResolvedPaths: 1 }
    });
    expect(result.ok).toBe(false);
    expect(result.provenance).toHaveLength(1);
    expect(result.resolvedPaths).toHaveLength(1);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "max_provenance_events_exceeded" }),
      expect.objectContaining({ code: "max_resolved_paths_exceeded" })
    ]));
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

  it("preserves winning and overridden source locations", () => {
    const result = resolveConfig({
      sources: [
        {
          ...source("defaults", 0, { server: { port: 3000 } }),
          locations: [{
            path: ["server", "port"],
            location: { sourceId: "defaults", sourcePath: "defaults.json", line: 2, column: 11 }
          }]
        },
        {
          ...source("local", 10, { server: { port: 8080 } }),
          locations: [{
            path: ["server", "port"],
            location: { sourceId: "local", sourcePath: "local.json", line: 4, column: 9 }
          }]
        }
      ]
    });

    expect(result.resolvedPaths).toContainEqual(expect.objectContaining({
      path: ["server", "port"],
      winningLocation: { sourceId: "local", sourcePath: "local.json", line: 4, column: 9 },
      overriddenLocations: [
        { sourceId: "defaults", sourcePath: "defaults.json", line: 2, column: 11 }
      ]
    }));
    expect(buildDiagnosticReport(result).resolvedPaths).toContainEqual(expect.objectContaining({
      path: ["server", "port"],
      winningLocation: { sourceId: "local", sourcePath: "local.json", line: 4, column: 9 }
    }));
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
});
