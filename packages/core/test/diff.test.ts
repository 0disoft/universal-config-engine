import { describe, expect, it } from "vitest";
import { buildConfigDiff, resolveConfig } from "../src/index.js";
import { source } from "./helpers/source.js";

function result(value: unknown, id = "file") { return resolveConfig({ sources: [source(id, 0, value)] }); }

describe("config diff", () => {
  it("compares complete values, explicit null, types, array indexes and sources deterministically", () => {
    const before = result({ same: 1, long: "a".repeat(1200) + "x", gone: null, type: 2, array: [1] });
    const after = result({ same: 1, long: "a".repeat(1200) + "y", added: null, type: "2", array: [2] });
    const report = buildConfigDiff(before, after);
    expect(report.status).toBe("ok");
    expect(report.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ["long"], kinds: ["value-changed"] }),
      expect.objectContaining({ path: ["gone"], kinds: ["removed"] }),
      expect.objectContaining({ path: ["added"], kinds: ["added"] }),
      expect.objectContaining({ path: ["type"], kinds: ["type-changed"] }),
      expect.objectContaining({ path: ["array", 0], kinds: ["value-changed"] })
    ]));
    expect(report.changes.some((change) => change.path[0] === "same")).toBe(false);
    expect(buildConfigDiff(result({ n: 1 }), result({ n: 1 }, "cli")).changes).toContainEqual(
      expect.objectContaining({ path: ["n"], kinds: ["source-changed"] }));
    expect(buildConfigDiff(before, before).changes).toEqual([]);
  });

  it("unions policies across both sides including removed policies and renamed source identities", () => {
    const input = source("vault", 0, { value: "before private input" });
    const before = resolveConfig({ sources: [{ ...input, descriptor: { ...input.descriptor, redaction: { secretSource: true } } }] });
    const after = result({ value: "after private input" }, "cli");
    const skipped = buildConfigDiff(before, after);
    expect(skipped.uncomparedSecretPaths).toEqual([["value"]]);
    expect(skipped.changes[0]?.kinds).toEqual(["source-changed"]);
    const detected = buildConfigDiff(before, after, { detectSecretChanges: true });
    expect(detected.changes[0]?.kinds).toEqual(["value-changed", "source-changed"]);
    for (const report of [skipped, detected]) {
      expect(JSON.stringify(report)).not.toContain("before private input");
      expect(JSON.stringify(report)).not.toContain("after private input");
      expect(JSON.stringify(report)).not.toContain("hash");
    }
  });

  it("compares opaque secret containers in memory without disclosing children", () => {
    const before = result({ password: { a: ["private before"] } });
    const after = result({ password: { a: ["private after"] } });
    const skipped = buildConfigDiff(before, after);
    expect(skipped.changes).toEqual([]);
    expect(skipped.uncomparedSecretPaths).toEqual([["password"]]);
    const detected = buildConfigDiff(before, after, { detectSecretChanges: true });
    expect(detected.changes).toHaveLength(1);
    expect(detected.changes[0]?.kinds).toEqual(["value-changed"]);
    expect(JSON.stringify(detected)).not.toContain("private before");
    expect(buildConfigDiff(result({ password: { a: 1, b: 2 } }), result({ password: { b: 2, a: 1 } }), { detectSecretChanges: true }).changes).toEqual([]);
  });

  it("keeps added paths private when a same-id source removes its whole-source policy", () => {
    const input = source("file", 0, { removed: "removed private input" });
    const before = resolveConfig({ sources: [{ ...input, descriptor: { ...input.descriptor, redaction: { secretSource: true } } }] });
    const report = buildConfigDiff(before, result({ added: "added private input" }));
    expect(report.status).toBe("ok");
    expect(report.changes.find((change) => change.path[0] === "added")?.after?.visibility).toBe("redacted");
    expect(JSON.stringify(report)).not.toContain("removed private input");
    expect(JSON.stringify(report)).not.toContain("added private input");
  });

  it("supports absent query sides, shape changes and fails closed on failed input and union limits", () => {
    expect(buildConfigDiff(result({}), result({ a: 1 }), { path: ["a"] }).changes[0]?.kinds).toEqual(["added"]);
    const before = result({ a: 1 });
    const after = result({ b: 2 });
    expect(buildConfigDiff({ ...before, ok: false }, after)).toMatchObject({ status: "error", changes: [] });
    expect(buildConfigDiff({ ...before, limits: { ...before.limits, maxResolvedPaths: 2 } }, after).error).toBe("max_diff_entries_exceeded");
    expect(buildConfigDiff(before, result({ a: {} })).changes[0]?.kinds).toContain("type-changed");
  });
});
