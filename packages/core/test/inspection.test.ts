import { describe, expect, it } from "vitest";
import { buildConfigInspection, resolveConfig, runConfigPipeline, type ConfigPath } from "../src/index.js";
import { source } from "./helpers/source.js";

describe("safe value inspection", () => {
  it("connects a selected value to coercion, source locations and root validation events", async () => {
    const input = source("file", 10, { port: "80" });
    const pipeline = await runConfigPipeline({ loaders: [{ descriptor: input.descriptor, load: () => ({
      value: input.value, locations: [{ path: ["port"], location: { sourceId: "file", sourcePath: "settings.json", line: 2, column: 3 } }]
    }) }], context: undefined, coercionRules: [{ path: ["port"], from: "string", to: "number", onFailure: "issue" }],
    validators: [{ id: "schema", validate: () => ({ ok: true, issues: [] }) }] });
    const report = buildConfigInspection(pipeline.result, { path: ["port"] });
    expect(report.entries[0]).toMatchObject({ value: 80, source: { winningLocation: { line: 2 } } });
    expect(report.diagnostics.provenance.map((event) => event.action)).toEqual(expect.arrayContaining(["defined", "coerced", "validated"]));
  });
  it("shows scalar values, typed array paths and source history without exposing nested secrets", () => {
    const result = resolveConfig({ sources: [
      source("defaults", 0, { port: 80, clients: [{ name: "visible", password: "private input" }], "a.b": { "": false } }),
      source("cli", 10, { port: 443 })
    ] });
    const report = buildConfigInspection(result);
    expect(report.status).toBe("ok");
    expect(report.entries).toContainEqual(expect.objectContaining({ path: ["port"], value: 443,
      source: expect.objectContaining({ winningSourceId: "cli", overriddenSourceIds: ["defaults"] }) }));
    expect(report.entries).toContainEqual(expect.objectContaining({ path: ["clients", 0, "password"], visibility: "redacted" }));
    expect(JSON.stringify(report)).not.toContain("private input");
    expect(buildConfigInspection(result, { path: ["a.b", ""] }).entries[0]?.value).toBe(false);
    expect(buildConfigInspection(result, { path: ["clients", "0"] }).status).toBe("error");
  });

  it("inherits overridden secret array source policy even for a directly selected descendant", () => {
    const lower = source("vault", 0, { items: [{ value: "lower" }] });
    const result = resolveConfig({ sources: [
      { ...lower, descriptor: { ...lower.descriptor, redaction: { secretSource: true } } },
      source("cli", 1, { items: [{ value: "upper private input" }], visible: 3 })
    ] });
    const report = buildConfigInspection(result, { path: ["items", 0, "value"] });
    expect(report.entries[0]?.visibility).toBe("redacted");
    expect(JSON.stringify(report)).not.toContain("upper private input");
    expect(buildConfigInspection(result, { path: ["visible"] }).entries[0]?.value).toBe(3);
  });

  it("combines option and source policies, truncates public previews and never retains hidden values", () => {
    const input = source("file", 0, { code: "private code", name: "private name", long: "abcdefgh" });
    const result = resolveConfig({ sources: [{ ...input, descriptor: { ...input.descriptor, redaction: { secretPaths: [["code"]] } } }] });
    const report = buildConfigInspection(result, { secretNamePatterns: ["name"], maxValueLength: 3 });
    expect(report.entries.find((e) => e.path[0] === "long")).toMatchObject({ value: "abc", truncated: true });
    expect(JSON.stringify(report)).not.toContain("private code");
    expect(JSON.stringify(report)).not.toContain("private name");
  });

  it("fails closed on failed resolution and entry/byte budgets", () => {
    const result = resolveConfig({ sources: [source("file", 0, { x: "visible", items: [1, 2, 3] })] });
    expect(buildConfigInspection({ ...result, ok: false }).entries).toEqual([]);
    for (const limits of [{ ...result.limits, maxResolvedPaths: 2 }, { ...result.limits, maxReportBytes: 80 }]) {
      expect(buildConfigInspection({ ...result, limits })).toMatchObject({ status: "error", entries: [] });
    }
    expect(buildConfigInspection(result, { path: [NaN] as ConfigPath }).status).toBe("error");
    expect(buildConfigInspection(result, { path: ["missing"] }).diagnostics.issues[0]?.code).toBe("inspection_path_not_found");
  });

  it("checks path and expansion limits before reading discarded input", () => {
    const result = resolveConfig({ sources: [source("file", 0, { items: [1, 2, 3] })] });
    let pathReads = 0;
    const path = new Array<string>(result.limits.maxPathLength + 1);
    path[Symbol.iterator] = function* () { pathReads += 1; yield "items"; return undefined; };
    expect(buildConfigInspection(result, { path }).status).toBe("error");
    expect(pathReads).toBe(0);
    let elementReads = 0;
    const array = (result.config as { items: number[] }).items;
    Object.defineProperty(array, 0, { get: () => { elementReads += 1; return 1; } });
    expect(buildConfigInspection({ ...result, limits: { ...result.limits, maxResolvedPaths: 2 } }).status).toBe("error");
    expect(elementReads).toBe(0);
  });
});
