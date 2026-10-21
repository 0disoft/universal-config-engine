import { describe, expect, it } from "vitest";
import { buildConfigInspection, resolveConfig, type ConfigPath } from "../src/index.js";
import { source } from "./helpers/source.js";

describe("safe value inspection", () => {
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
});
