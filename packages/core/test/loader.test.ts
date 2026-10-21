import { describe, expect, it } from "vitest";
import {
  buildDiagnosticReport,
  getConfigValueAtPath,
  loadConfigSources,
  resolveConfig
} from "../src/index.js";
import type { ConfigLoader, ConfigLoaderResult } from "../src/index.js";

describe("loadConfigSources", () => {
  const withLocations = (locations: unknown[], limits = {}) => loadConfigSources({ context: undefined, limits,
    loaders: [{ descriptor: { id: "file", kind: "adapter", priority: 0, displayName: "file" },
      load: () => ({ value: { port: 80 }, locations }) as ConfigLoaderResult }] });
  const position = (path: (string | number)[] = ["port"], line = 1, sourcePath?: string) => ({
    path, location: { sourceId: "untrusted", line, ...(sourcePath === undefined ? {} : { sourcePath }) }
  });

  it("deduplicates locations before copying paths and keeps the last position", async () => {
    let copies = 0;
    const path = Object.defineProperty(["port"], Symbol.iterator, { value: function* () { copies++; yield "port"; } });
    const positions = new Array(1_000).fill(position(path));
    positions.push(position(path, 2));
    const loaded = await withLocations(positions, { maxResolvedPaths: 1 });
    expect(loaded.issues).toEqual([]);
    expect(loaded.sources[0]?.locations).toEqual([{ path: ["port"], location: { sourceId: "file", line: 2 } }]);
    expect(copies).toBe(positions.length + 1);
  });

  it.each([
    { locations: [position(), position(["other"])], limits: { maxResolvedPaths: 1 } },
    { locations: [position(["too", "deep"])], limits: { maxPathLength: 1 } },
    { locations: [position(["port"], 1, "x".repeat(2_000))], limits: { maxReportBytes: 1024 } },
    { locations: [position(["port"], 1, "😀".repeat(300))], limits: { maxReportBytes: 1024 } }
  ])("omits optional locations exceeding count, path or UTF-8 budgets", async ({ locations, limits }) => {
    const loaded = await withLocations(locations, limits);
    expect(loaded.sources[0]?.locations).toEqual([]);
    expect(loaded.issues).toEqual([expect.objectContaining({ code: "max_location_metadata_exceeded", severity: "warning" })]);
    expect(resolveConfig({ sources: loaded.sources })).toMatchObject({ ok: true, config: { port: 80 } });
    expect((await withLocations([...locations, null], limits)).issues).toEqual([
      expect.objectContaining({ code: "invalid_loader_result", severity: "error" })
    ]);
  });

  it("accepts the exact serialized location byte limit and distinguishes typed paths", async () => {
    const prefix = { path: ["port"], location: { sourceId: "file", sourcePath: "", line: 1 } };
    const bytes = new TextEncoder().encode(JSON.stringify(prefix)).byteLength;
    const loaded = await withLocations([position(["port"], 1, "x".repeat(1024 - bytes))], { maxReportBytes: 1024 });
    expect(loaded.issues).toEqual([]);
    expect(loaded.sources[0]?.locations).toHaveLength(1);
    expect((await withLocations([position(["array", 0]), position(["array", "0"])])).sources[0]?.locations).toHaveLength(2);
  });

  it("rejects non-finite priorities before any loader callback runs, with bounded issues", async () => {
    let calls = 0;
    const loaded = await loadConfigSources({ context: undefined, limits: { maxDiagnostics: 1 },
      loaders: [0, NaN, Infinity].map((priority, index) => ({
        descriptor: { id: `input-${index}`, kind: "object", priority, displayName: "input" },
        load() { calls++; return { value: {} }; }
      })) });
    expect(calls).toBe(0);
    expect(loaded.sources).toEqual([]);
    expect(loaded.issues).toEqual([expect.objectContaining({ code: "max_diagnostics_exceeded", severity: "error" })]);
  });

  it("cannot hide a discarded error behind an adapter's warning-shaped overflow marker", async () => {
    const loaded = await loadConfigSources({ context: undefined, limits: { maxDiagnostics: 2 },
      loaders: [{ descriptor: { id: "noisy", kind: "adapter", priority: 0, displayName: "noisy" },
        load: () => ({ value: { enabled: true }, issues: [
          { category: "resource-limit", code: "max_diagnostics_exceeded", severity: "warning", message: "Adapter warning." },
          { category: "parse", code: "notice", severity: "warning", message: "Another warning." },
          { category: "parse", code: "invalid", severity: "error", message: "Rejected input." }
        ] }) }] });
    expect(loaded.issues).toContainEqual(expect.objectContaining({
      category: "resource-limit", code: "max_diagnostics_exceeded", severity: "error"
    }));
    const resolved = resolveConfig({ sources: loaded.sources });
    expect(resolved.ok).toBe(false);
    expect(resolved.config).toEqual({});
  });

  it("validates all issues but copies paths only within the retained diagnostic budget", async () => {
    let pathPasses = 0;
    const path = Object.defineProperty(["item"], Symbol.iterator, { value: function* () {
      pathPasses += 1;
      yield "item";
    } });
    const issue = { category: "parse" as const, code: "noisy", severity: "warning" as const,
      message: "Loader warning.", path, details: { count: 1 } };
    const loaded = await loadConfigSources({ context: undefined, limits: { maxDiagnostics: 3 },
      loaders: [{ descriptor: { id: "noisy", kind: "adapter", priority: 0, displayName: "noisy" },
        load: () => ({ value: { enabled: true }, issues: new Array(1_000).fill(issue) }) }] });
    expect(pathPasses).toBe(1_003);
    expect(loaded.sources[0]?.issues?.map((entry) => entry.code)).toEqual(["noisy", "noisy", "max_diagnostics_exceeded"]);
    expect(loaded.issues).toEqual(loaded.sources[0]?.issues);
    expect(loaded.sources[0]?.issues?.[0]?.path).not.toBe(path);
    expect(loaded.sources[0]?.issues?.[0]?.details).not.toBe(issue.details);
    expect(resolveConfig({ sources: loaded.sources }).config).toEqual({});
  });

  it("still rejects malformed diagnostics beyond the retained budget", async () => {
    const issue = { category: "parse", code: "noisy", severity: "warning", message: "Loader warning." };
    const loaded = await loadConfigSources({ context: undefined, limits: { maxDiagnostics: 1 },
      loaders: [{ descriptor: { id: "invalid", kind: "adapter", priority: 0, displayName: "invalid" },
        load: () => ({ value: { enabled: true }, issues: [issue, issue, null] }) as ConfigLoaderResult }] });
    expect(loaded.issues).toEqual([expect.objectContaining({ code: "invalid_loader_result" })]);
    expect(loaded.sources[0]?.value).toEqual({});
  });

  it.each([
    { name: "negative index", path: ["items", -1] },
    { name: "fractional index", path: ["items", 0.5] },
    { name: "non-finite index", path: ["items", Infinity] },
    { name: "sparse path", path: new Array<string>(1) }
  ])("rejects $name in both loader issue and location paths", async ({ path }) => {
    for (const result of [
      { value: {}, issues: [{ category: "parse", code: "bad_input", severity: "error", message: "Invalid input.", path }] },
      { value: {}, locations: [{ path, location: { sourceId: "adapter", line: 1 } }] }
    ]) {
      const loaded = await loadConfigSources({
        loaders: [{
          descriptor: { id: "adapter", kind: "adapter", priority: 0, displayName: "adapter" },
          load: () => result as ConfigLoaderResult
        }],
        context: undefined
      });
      expect(loaded.issues).toEqual([expect.objectContaining({ code: "invalid_loader_result" })]);
      expect(loaded.sources[0]?.value).toEqual({});
    }
  });

  it("rejects excess loaders before invoking them", async () => {
    let invoked = false;
    const loader = (id: string): ConfigLoader => ({
      descriptor: { id, kind: "adapter", priority: 0, displayName: id },
      load() {
        invoked = true;
        return { value: {} };
      }
    });
    const loaded = await loadConfigSources({
      loaders: [loader("one"), loader("two")],
      context: undefined,
      limits: { maxSources: 1 }
    });

    expect(invoked).toBe(false);
    expect(loaded.sources).toEqual([]);
    expect(loaded.issues).toContainEqual(expect.objectContaining({ code: "max_sources_exceeded" }));
  });

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
