import { describe, expect, it } from "vitest";
import type { ConfigIssue } from "@0disoft/universal-config-engine-core";
import { appendDeclarationIssues, PipelineDeclarationError } from "../src/pipeline/declaration-diagnostics.js";

const issues: readonly ConfigIssue[] = Array.from({ length: 201 }, (_, index) => ({
  category: "source-load",
  code: `issue_${index}`,
  severity: "error",
  message: `Issue ${index}.`
}));

describe("declaration diagnostic budget", () => {
  it("allows exactly 200 issues, then retains order and one bootstrap marker", () => {
    const destination: ConfigIssue[] = [];
    expect(appendDeclarationIssues(destination, issues.slice(0, 200))).toBe(true);
    expect(destination).toEqual(issues.slice(0, 200));
    expect(appendDeclarationIssues(destination, issues.slice(200))).toBe(false);
    expect(destination).toHaveLength(200);
    expect(destination.slice(0, 199)).toEqual(issues.slice(0, 199));
    expect(destination.at(-1)?.message).toBe("Pipeline declaration diagnostics exceeded the bootstrap maximum of 200.");
    const marker = destination.at(-1);
    expect(appendDeclarationIssues(destination, issues)).toBe(false);
    expect(destination.at(-1)).toBe(marker);
  });

  it("bounds directly constructed errors using the same bootstrap policy", () => {
    const error = new PipelineDeclarationError(issues);
    expect(error.issues).toHaveLength(200);
    expect(error.issues.slice(0, 199)).toEqual(issues.slice(0, 199));
    expect(error.issues.at(-1)?.code).toBe("max_diagnostics_exceeded");
    expect(error.issues.at(-1)?.message).toContain("bootstrap maximum of 200");
    expect(issues).toHaveLength(201);
  });
});
