import { describe, expect, it } from "vitest";
import { buildDiagnosticReport, resolveConfig } from "../src/index.js";
import { source } from "./helpers/source.js";

describe("resolution metadata ownership", () => {
  it.each(["success", "source-limit", "duplicate-id"])("owns source policy arrays on %s", failure => {
    const descriptor = { ...source("base", 0, {}).descriptor,
      redaction: { secretPaths: [["opaqueValue"]], secretNamePatterns: ["opaquePattern"] } };
    const first = { descriptor, value: { opaqueValue: 1, opaquePattern: 2 } };
    const result = resolveConfig({ sources: failure === "success" ? [first] : [first,
      source(failure === "duplicate-id" ? "base" : "other", 1, {})],
      ...(failure === "source-limit" ? { limits: { maxSources: 1 } } : {}) });
    expect(result.ok).toBe(failure === "success");
    descriptor.redaction.secretPaths[0]![0] = "changed";
    descriptor.redaction.secretNamePatterns.length = 0;
    expect(result.sources[0]?.redaction).toEqual({
      secretPaths: [["opaqueValue"]], secretNamePatterns: ["opaquePattern"]
    });
    if (failure === "success") {
      expect(buildDiagnosticReport(result).resolvedPaths.every(path => path.redacted)).toBe(true);
    }
    expect(Object.isFrozen(descriptor.redaction)).toBe(false);
  });

  it.each([false, true])("owns report metadata with redaction %s", redacted => {
    const result = resolveConfig({ sources: [
      { ...source("base", 0, { field: 1 }), locations: [{ path: ["field"],
        location: { sourceId: "base", sourcePath: "base.json", line: 1 } }] },
      { ...source("override", 1, { field: 2 }), locations: [{ path: ["field"],
        location: { sourceId: "override", sourcePath: "override.json", line: 2 } }] }
    ] });
    const input = { ...result, issues: [{ category: "validation" as const, severity: "warning" as const,
      code: "example", message: "example", path: ["field"], details: { context: "original" } }] };
    const report = buildDiagnosticReport(input, redacted ? { secretPaths: [["field"]] } : {});
    const before = JSON.stringify(report);
    const resolved = result.resolvedPaths[0]!;
    // Exercise runtime consumers that are not constrained by TypeScript readonly.
    (resolved.path as string[])[0] = "changed";
    (resolved.overriddenSourceIds as string[]).push("changed");
    Object.assign(resolved.winningLocation!, { line: 99 });
    Object.assign(resolved.overriddenLocations![0]!, { line: 99 });
    input.issues[0]!.path[0] = "changed";
    input.issues[0]!.details.context = "changed";
    (result.provenance[0]!.path as string[])[0] = "changed";
    Object.assign(result.limits, { maxSources: 1 });
    expect(JSON.stringify(report)).toBe(before);
    expect(report.resolvedPaths[0]?.redacted).toBe(redacted);
    const mutatedInput = JSON.stringify(input);
    (report.resolvedPaths[0]!.path as string[])[0] = "report-only";
    (report.issues[0]!.path as string[])[0] = "report-only";
    (report.provenance[0]!.path as string[])[0] = "report-only";
    Object.assign(report.limits, { maxSources: 2 });
    expect(JSON.stringify(input)).toBe(mutatedInput);
  });
});
