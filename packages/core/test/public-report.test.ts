import { describe, expect, it } from "vitest";
import { buildDiagnosticReport, buildPublicDiagnosticReport, resolveConfig } from "../src/index.js";
import { source } from "./helpers/source.js";

describe("public-share report projection", () => {
  it("omits values, original metadata and arbitrary fields while retaining relationships", () => {
    const result = resolveConfig({ sources: [source("PRIVATE_ID", 123456, { PRIVATE_PATH: "PRIVATE_VALUE" })] });
    const report = buildDiagnosticReport({ ...result, issues: [{ category: "validation", severity: "warning", code: "PRIVATE_CODE",
      message: "PRIVATE_MESSAGE", sourceId: "PRIVATE_ID", path: ["PRIVATE_PATH"], details: { private: "PRIVATE_DETAIL" } }] });
    const projected = buildPublicDiagnosticReport({ ...report, sources: report.sources.map(entry => ({ ...entry, displayName: "PRIVATE_NAME" })),
      resolvedPaths: report.resolvedPaths.map(entry => ({ ...entry, winningLocation: { sourceId: "PRIVATE_ID", sourcePath: "PRIVATE_FILE" } })) });
    expect(JSON.stringify(projected)).not.toContain("PRIVATE_");
    expect(JSON.stringify(projected)).not.toContain("123456");
    expect(projected.sources[0]?.id).toBe("source-1");
    expect(projected.resolvedPaths[0]).toMatchObject({ path: "path-1", winningSource: "source-1" });
    expect(projected.issues[0]).toEqual({ category: "validation", severity: "warning", source: "source-1", path: "path-1" });
    expect(projected.provenance[0]).toMatchObject({ source: "source-1", path: "path-1" });
    expect(buildPublicDiagnosticReport(report)).toEqual(projected);
  });

  it("does not trust strings disguised as enum values", () => {
    const report = buildDiagnosticReport(resolveConfig({ sources: [source("base", 0, { port: 80 })] }));
    const projected = buildPublicDiagnosticReport({ ...report, sources: [{ ...report.sources[0]!, kind: "PRIVATE_KIND" as never }],
      issues: [{ category: "PRIVATE_CATEGORY" as never, code: "PRIVATE_CODE", message: "PRIVATE_MESSAGE", severity: "error" }],
      provenance: [{ ...report.provenance[0]!, action: "PRIVATE_ACTION" as never }] });
    expect(projected.sources[0]?.kind).toBe("other"); expect(projected.issues[0]?.category).toBe("other");
    expect(JSON.stringify(projected)).not.toContain("PRIVATE_");
  });

  it("discards all projected entries on byte overflow", () => {
    const report = buildDiagnosticReport(resolveConfig({ sources: [source("base", 0, { port: 80 })] }));
    expect(buildPublicDiagnosticReport({ ...report, limits: { ...report.limits, maxReportBytes: 1 } }))
      .toEqual({ schemaVersion: "public-diagnostic-1", status: "error", sources: [], resolvedPaths: [], issues: [], provenance: [], truncated: true });
  });
});
