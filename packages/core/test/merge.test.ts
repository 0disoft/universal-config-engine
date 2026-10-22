import { describe, expect, it } from "vitest";
import {
  buildDiagnosticReport,
  createMappedOverrideSource,
  getConfigValueAtPath,
  resolveConfig,
  runConfigPipeline,
  setConfigValueAtPath
} from "../src/index.js";
import { source } from "./helpers/source.js";
import type { ConfigIssue } from "../src/index.js";

describe("resolveConfig", () => {
  it("bounds retained location fanout after JSON coercion projects a parent history", () => {
    const bag = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`k${i}`, i]));
    const result = resolveConfig({ sources: [
      { ...source("a", 0, { bag }), locations: Object.keys(bag).map((key, i) => ({
        path: ["bag", key], location: { sourceId: "a", sourcePath: "a.json", line: i + 1, column: 1 }
      })) }, source("b", 1, { bag: JSON.stringify(bag) })
    ], coercionRules: [{ path: ["bag"], from: "string", to: "json", onFailure: "issue" }] });
    expect(result.ok).toBe(true);
    expect(result.config).toEqual({ bag });
    expect(result.resolvedPaths.reduce((count, path) => count + (path.overriddenLocations?.length ?? 0), 0))
      .toBeLessThanOrEqual(result.limits.maxResolvedPaths);
    expect(result.resolvedPaths.every(path => path.winningSourceId === "b" && path.overriddenSourceIds.includes("a"))).toBe(true);
    expect(result.issues.filter(issue => issue.code === "max_location_metadata_exceeded")).toHaveLength(1);
    expect(buildDiagnosticReport(result).status).toBe("ok");
  });

  it.each([4 * 1024 * 1024, 64_000])("bounds aggregate history when distinct locations fan out (bytes: %s)", async maxReportBytes => {
    const bag = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`k${i}`, i]));
    const first = source("a", 0, { bag });
    const scalar = source("b", 1, { bag: 0 });
    const last = source("c", 2, { bag });
    const run = await runConfigPipeline({ context: undefined, limits: { maxReportBytes }, loaders: [
      { descriptor: first.descriptor, load: () => ({ value: first.value, locations: Object.keys(bag).map((key, i) => ({
        path: ["bag", key], location: { sourceId: "a", sourcePath: "a.json", line: i + 1, column: 1 }
      })) }) },
      { descriptor: scalar.descriptor, load: () => ({ value: scalar.value, locations: [{ path: ["bag"],
        location: { sourceId: "b", sourcePath: "b.json", line: 1, column: 1 } }] }) },
      { descriptor: last.descriptor, load: () => ({ value: last.value }) }
    ] });
    expect(run.result.ok).toBe(true);
    expect(run.result.config).toEqual({ bag });
    const locations = run.result.resolvedPaths.flatMap(path => path.overriddenLocations ?? []);
    expect(locations.length).toBeLessThanOrEqual(run.result.limits.maxResolvedPaths);
    expect(locations.reduce((bytes, location) => bytes + new TextEncoder().encode(JSON.stringify(location)).byteLength, 0))
      .toBeLessThanOrEqual(maxReportBytes);
    expect(run.result.issues.filter(issue => issue.code === "max_location_metadata_exceeded")).toHaveLength(1);
    expect(run.result.resolvedPaths.every(path => path.winningSourceId === "c" &&
      path.overriddenSourceIds.includes("a") && path.overriddenSourceIds.includes("b"))).toBe(true);
    if (maxReportBytes === 4 * 1024 * 1024) expect(run.report.status).toBe("ok");
  });

  it("deduplicates shared parent locations through repeated shape replacements", () => {
    const location = { sourceId: "initial", sourcePath: "base.json", line: 1, column: 1 };
    const sources = [{ ...source("initial", 0, { root: 0 }), locations: [{ path: ["root"], location }] }];
    const replacements = Array.from({ length: 18 }, (_, index) => [
      source(`expand-${index}`, index * 2 + 1, { root: { a: 1, b: 2 } }),
      source(`collapse-${index}`, index * 2 + 2, { root: 0 })
    ]).flat();
    const result = resolveConfig({ sources: [...sources, ...replacements] });
    expect(result.ok).toBe(true);
    expect(result.resolvedPaths[0]?.overriddenLocations).toEqual([location]);
  });

  it("omits oversized optional override locations without rejecting config", () => {
    const result = resolveConfig({ limits: { maxReportBytes: 1024 }, sources: [
      { ...source("base", 0, { port: 1 }), locations: [{ path: ["port"],
        location: { sourceId: "base", sourcePath: "x".repeat(1025) } }] },
      source("override", 1, { port: 2 })
    ] });
    expect(result.ok).toBe(true);
    expect(result.config).toEqual({ port: 2 });
    expect(result.resolvedPaths[0]?.overriddenLocations ?? []).toEqual([]);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "max_location_metadata_exceeded", severity: "warning" }));
  });

  it("stops aggregate key growth before writing or reading subsequent source values", () => {
    let reads = 0;
    const result = resolveConfig({ limits: { maxKeyCount: 1 }, sources: Array.from({ length: 64 }, (_, index) => ({
      ...source(`s${index}`, index, {}), get value() { reads++; return { [`k${index}`]: index }; }
    })) });
    expect(result.ok).toBe(false);
    expect(result.config).toEqual({ k0: 0 });
    expect(result.resolvedPaths).toHaveLength(1);
    expect(reads).toBe(2);
    expect(result.issues).toEqual([expect.objectContaining({ code: "max_key_count_exceeded" })]);
  });

  it("counts array descendants and releases removed keys when shapes are replaced", () => {
    const sources = [source("base", 0, { items: [{ x: 1 }, 2] }),
      source("shape", 1, { items: { value: 3 } }), source("extra", 2, { a: 1, b: 2 })];
    expect(resolveConfig({ sources, limits: { maxKeyCount: 4 } })).toMatchObject({
      ok: true, config: { items: { value: 3 }, a: 1, b: 2 }
    });
    const overflow = resolveConfig({ sources: [sources[0]!, source("extra", 2, { other: 1 })], limits: { maxKeyCount: 4 } });
    expect(overflow.ok).toBe(false);
    expect(overflow.config).toEqual({ items: [{ x: 1 }, 2] });
    expect(overflow.issues).toContainEqual(expect.objectContaining({ code: "max_key_count_exceeded" }));
  });

  it.each(["old", [], {}])("preserves displaced parent history for every child replacing %j", (previous) => {
    for (const names of [["alpha", "beta"], ["beta", "alpha"]]) {
      const location = { sourceId: "vault", line: 2, column: 3 };
      const original = source("vault", 0, { auth: previous, unrelated: 1 });
      const result = resolveConfig({ sources: [
        { ...original, descriptor: { ...original.descriptor, redaction: { secretSource: true } },
          locations: [{ path: ["auth"], location }] },
        source("file", 1, { auth: Object.fromEntries(names.map(name => [name, { value: 1 }])) }),
        source("cli", 2, { public: 2 })
      ] });
      expect(result.ok).toBe(true);
      const report = buildDiagnosticReport(result);
      for (const name of names) {
        expect(result.resolvedPaths).toContainEqual(expect.objectContaining({
          path: ["auth", name, "value"], overriddenSourceIds: ["vault"], overriddenLocations: [location]
        }));
        expect(result.provenance).toContainEqual(expect.objectContaining({
          path: ["auth", name, "value"], action: "overridden", previousSourceId: "vault"
        }));
        expect(report.resolvedPaths).toContainEqual(expect.objectContaining({ path: ["auth", name, "value"], redacted: true }));
      }
      expect(report.resolvedPaths).toContainEqual(expect.objectContaining({ path: ["public"], redacted: false }));
    }
  });

  it("records the immediately previous winner while retaining oldest-first override history", () => {
    const ids = ["defaults", "file", "env", "cli"];
    const result = resolveConfig({ sources: ids.map((id, priority) => source(id, priority, { port: 80 + priority })) });
    expect(result.ok).toBe(true);
    expect(result.provenance.filter(event => event.action === "overridden").map(event =>
      [event.sourceId, event.previousSourceId, event.message])).toEqual([
      ["file", "defaults", "Source file overrode source defaults."],
      ["env", "file", "Source env overrode source file."],
      ["cli", "env", "Source cli overrode source env."]
    ]);
    expect(result.resolvedPaths[0]?.overriddenSourceIds).toEqual(["defaults", "file", "env"]);
  });

  it("uses the current overlapping winner for parent and child shape replacements", () => {
    const result = resolveConfig({ sources: [
      source("defaults", 0, { server: { host: "localhost", port: 80 } }),
      source("site", 1, { server: { port: 81 } }),
      source("env", 2, { server: "disabled" }),
      source("cli", 3, { server: { port: 82 } })
    ] });
    expect(result.ok).toBe(true);
    expect(result.provenance).toContainEqual(expect.objectContaining({
      path: ["server"], sourceId: "env", previousSourceId: "site"
    }));
    expect(result.provenance).toContainEqual(expect.objectContaining({
      path: ["server", "port"], sourceId: "cli", previousSourceId: "env"
    }));
    expect(result.resolvedPaths[0]?.overriddenSourceIds).toEqual(["defaults", "site", "env"]);
  });

  it.each([NaN, Infinity, -Infinity])("rejects priority %s before inspecting values or applying precedence", (priority) => {
    let reads = 0;
    const bad = { ...source("bad", priority, {}), get value() { reads++; throw new Error("Must not load invalid metadata."); } };
    const result = resolveConfig({ sources: [source("high", 10, { port: 9000 }), bad, source("low", 0, { port: 80 })] });
    expect(result.ok).toBe(false);
    expect(result.config).toEqual({});
    expect(result.sources).toEqual([]);
    expect(result.issues).toEqual([expect.objectContaining({ code: "source_priority_invalid", sourceId: "bad" })]);
    expect(reads).toBe(0);
    expect(buildDiagnosticReport(result).status).toBe("error");
  });

  it("retains finite fractional and negative priority ordering", () => {
    const result = resolveConfig({ sources: [source("higher", -0.5, { port: 9000 }), source("lower", -1, { port: 80 })] });
    expect(result.ok).toBe(true);
    expect(result.config).toEqual({ port: 9000 });
  });

  it.each([0, 10])("deep merges an empty object without removing descendants or their ownership (priority %i)", (priority) => {
    const location = { sourceId: "defaults", line: 2, column: 3 };
    const result = resolveConfig({ sources: [
      { ...source("defaults", 0, { server: { port: 8080, host: "localhost" } }),
        locations: [{ path: ["server", "port"], location }] },
      source("empty", priority, { server: {} }),
      source("override", 20, { server: { host: "example.invalid" } })
    ] });
    expect(result.ok).toBe(true);
    expect(result.config).toEqual({ server: { port: 8080, host: "example.invalid" } });
    expect(result.resolvedPaths).toContainEqual(expect.objectContaining({
      path: ["server", "port"], winningSourceId: "defaults", winningLocation: location, overriddenSourceIds: []
    }));
    expect(result.resolvedPaths).toContainEqual(expect.objectContaining({
      path: ["server", "host"], winningSourceId: "override", overriddenSourceIds: ["defaults"]
    }));
    expect(result.provenance.some(event => event.sourceId === "empty")).toBe(false);
  });

  it.each([null, [], 42, false, {}])("can still replace %j with an explicit empty object", (previous) => {
    const result = resolveConfig({ sources: [source("base", 0, { server: previous }), source("empty", 1, { server: {} })] });
    expect(result.ok).toBe(true);
    expect(result.config).toEqual({ server: {} });
    expect(result.resolvedPaths).toEqual([expect.objectContaining({ path: ["server"], winningSourceId: "empty" })]);
  });

  it("bounds issue reads when rejecting a source with an excessive diagnostic tail", () => {
    const issue: ConfigIssue = {
      category: "parse", code: "invalid", severity: "error", message: "Rejected input."
    };
    let reads = 0;
    const issues = new Proxy(Array<ConfigIssue>(100_000).fill(issue), {
      get(target, key, receiver) {
        if (typeof key === "string" && /^(0|[1-9][0-9]*)$/.test(key)) reads++;
        return Reflect.get(target, key, receiver);
      }
    });
    const result = resolveConfig({
      sources: [{ ...source("noisy", 0, { enabled: true }), issues }],
      limits: { maxDiagnostics: 2 }
    });

    expect(result.ok).toBe(false);
    expect(result.config).toEqual({});
    expect(result.issues).toEqual([
      issue, expect.objectContaining({ code: "max_diagnostics_exceeded", severity: "error" })
    ]);
    expect(result.provenance).toContainEqual(expect.objectContaining({ action: "rejected", sourceId: "noisy" }));
    expect(reads).toBeLessThanOrEqual(4);
    expect(issues).toHaveLength(100_000);
  });

  it("rejects a source whose error is beyond the retained diagnostic prefix", () => {
    const warning: ConfigIssue = {
      category: "parse", code: "notice", severity: "warning", message: "Input notice."
    };
    const result = resolveConfig({
      sources: [{ ...source("tail-error", 0, { enabled: true }), issues: [
        warning, warning, warning, { ...warning, code: "invalid", severity: "error" }
      ] }],
      limits: { maxDiagnostics: 2 }
    });

    expect(result.ok).toBe(false);
    expect(result.config).toEqual({});
    expect(result.issues).toHaveLength(2);
    expect(result.provenance).toContainEqual(expect.objectContaining({ action: "rejected" }));
  });

  it("keeps source warnings before structure errors without mutating adapter issues", () => {
    const warning: ConfigIssue = {
      category: "parse", code: "notice", severity: "warning", message: "Input notice."
    };
    const issues = Object.freeze([warning]);
    const result = resolveConfig({
      sources: [{ ...source("invalid-value", 0, { port: NaN }), issues }],
      limits: { maxDiagnostics: 2 }
    });

    expect(result.issues).toEqual([warning, expect.objectContaining({ code: "invalid_value" })]);
    expect(result.config).toEqual({});
    expect(issues).toEqual([warning]);
  });

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
