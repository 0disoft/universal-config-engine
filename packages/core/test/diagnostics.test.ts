import { describe, expect, it } from "vitest";
import { combineConfigIssues, type ConfigIssue } from "../src/index.js";

const issues: readonly ConfigIssue[] = ["first", "second", "third"].map((code) => ({
  category: "validation",
  code,
  severity: "warning",
  message: code
}));

describe("combineConfigIssues", () => {
  it.each([1, 2])("does not treat a warning as a fatal overflow marker at limit %i", (limit) => {
    const warning: ConfigIssue = { category: "resource-limit", code: "max_diagnostics_exceeded",
      severity: "warning", message: "An adapter warning." };
    const bounded = combineConfigIssues([warning], issues, limit);
    expect(bounded).toHaveLength(limit);
    expect(bounded.at(-1)).toMatchObject({ category: "resource-limit", code: "max_diagnostics_exceeded", severity: "error" });
    expect(warning.severity).toBe("warning");
    expect(combineConfigIssues([warning], [], limit)).toEqual([warning]);
  });

  it("retains an exactly full batch without an overflow marker or input mutation", () => {
    const existing = Object.freeze(issues.slice(0, 1));
    const next = Object.freeze(issues.slice(1, 2));
    expect(combineConfigIssues(existing, next, 2)).toEqual(issues.slice(0, 2));
    expect(existing).toEqual([issues[0]]);
    expect(next).toEqual([issues[1]]);
  });

  it.each([0, 1, 2])("uses the final slot for overflow at declared limit %i", (limit) => {
    const bounded = combineConfigIssues(issues.slice(0, 1), issues.slice(1), limit);
    expect(bounded).toHaveLength(Math.max(1, limit));
    expect(bounded.at(-1)).toEqual({
      category: "resource-limit",
      code: "max_diagnostics_exceeded",
      severity: "error",
      message: `Diagnostics exceeded the maximum of ${Math.max(1, limit)}.`
    });
    if (limit === 2) expect(bounded[0]).toBe(issues[0]);
  });

  it("preserves a supplied overflow marker without duplicating it", () => {
    const marker: ConfigIssue = {
      category: "resource-limit",
      code: "max_diagnostics_exceeded",
      severity: "error",
      message: "Earlier stage reached its limit."
    };
    expect(combineConfigIssues([marker], issues, 2)).toEqual([marker, issues[0]]);
  });

  it("truncates existing issues without inventing overflow when there is no new input", () => {
    expect(combineConfigIssues(issues, [], 2)).toEqual(issues.slice(0, 2));
  });
});
