import { describe, expect, it } from "vitest";
import { buildConfigDiff, checkConfigChanges, resolveConfig, type ConfigChangePolicy } from "../src/index.js";
import { source } from "./helpers/source.js";

const result = (value: unknown, id = "file") => resolveConfig({ sources: [source(id, 0, value)] });
const policy = (rules: ConfigChangePolicy["rules"]): ConfigChangePolicy => ({ version: "change-policy-1", rules });

describe("CI change policies", () => {
  it("reports independent forbidden changes, required-path deletion and unexpected source ownership", () => {
    const check = checkConfigChanges(result({ port: 80, enabled: null }), result({ port: 443 }, "env"), policy([
      { id: "stable-port", path: ["port"], mode: "forbid-changes" },
      { id: "required", path: ["enabled"], mode: "require-path" },
      { id: "file-only", path: [], mode: "allowed-sources", allowedSourceIds: ["file"] }
    ]));
    expect(check.status).toBe("error");
    expect(check.policy).toMatchObject({ status: "failed", violations: [
      { ruleId: "stable-port", code: "change_forbidden" },
      { ruleId: "required", code: "required_path_missing" },
      { ruleId: "file-only", code: "source_not_allowed" }
    ] });
    expect(checkConfigChanges(result({}), result({ enabled: null }), policy([
      { id: "required", path: ["enabled"], mode: "require-path" }
    ])).policy.status).toBe("passed");
  });

  it("fails closed on unknown secret changes and supports explicit in-memory detection", () => {
    const before = result({ password: { nested: "private before" } });
    const after = result({ password: { nested: "private after" } });
    const rules = policy([{ id: "stable", path: ["password"], mode: "forbid-changes" }]);
    expect(checkConfigChanges(before, after, rules).policy.violations[0]?.code).toBe("comparison_indeterminate");
    const check = checkConfigChanges(before, after, rules, { detectSecretChanges: true });
    expect(check.policy.violations[0]?.code).toBe("change_forbidden");
    expect(JSON.stringify(check)).not.toContain("private before");
    expect(JSON.stringify(check)).not.toContain("private after");
    expect(checkConfigChanges(before, before, rules, { detectSecretChanges: true }).policy.status).toBe("passed");
    expect(checkConfigChanges(before, after, policy([{ id: "nested", path: ["password", "nested"], mode: "require-path" }])).policy.status).toBe("passed");
    const stableChild = policy([{ id: "stable-child", path: ["password", "stable"], mode: "forbid-changes" }]);
    expect(checkConfigChanges(result({ password: { stable: 1, changed: 1 } }), result({ password: { stable: 1, changed: 2 } }),
      stableChild, { detectSecretChanges: true }).policy.status).toBe("passed");
  });

  it("rejects malformed policies instead of accepting vacuous or coerced rules", () => {
    const input = result({ port: 80 });
    const invalid = [null, {}, { version: "change-policy-1", rules: [null] },
      policy([{ id: "bad", path: ["__proto__"], mode: "require-path" }]),
      { version: "change-policy-1", rules: [{ id: "bad", path: [], mode: ["forbid-changes"] }] },
      policy([{ id: "bad", path: [], mode: "allowed-sources", allowedSourceIds: [] }]),
      { version: "change-policy-1", rules: new Array(257) },
      { version: "change-policy-1", rules: [{ id: "bad", path: [Infinity], mode: "require-path" }] },
      { version: "change-policy-1", rules: [], unknown: "private invalid input" }];
    for (const rules of invalid) expect(checkConfigChanges(input, input, rules).policy.violations[0]?.code).toBe("invalid_policy");
    expect(checkConfigChanges({ ...input, ok: false }, input, policy([])).policy.violations[0]?.code).toBe("comparison_failed");
    let reads = 0;
    const path = new Array<string>(257);
    path[Symbol.iterator] = function* () { reads += 1; yield "port"; return undefined; };
    expect(checkConfigChanges(input, input, policy([{ id: "too-long", path, mode: "require-path" }])).policy.status).toBe("error");
    expect(reads).toBe(0);
  });

  it("enforces whole-config policies and wrapper byte budgets", () => {
    const before = result({ stable: 1, changed: 1 });
    const after = result({ stable: 1, changed: 2 });
    const rules = policy([{ id: "all", path: [], mode: "forbid-changes" }]);
    const narrowed = { path: ["stable"] };
    expect(checkConfigChanges(before, after, rules, narrowed as {}).policy.status).toBe("failed");
    const bytes = new TextEncoder().encode(JSON.stringify(buildConfigDiff(before, after))).byteLength + 10;
    const check = checkConfigChanges({ ...before, limits: { ...before.limits, maxReportBytes: bytes } }, after, rules);
    expect(check.policy.violations[0]?.code).toBe("max_report_bytes_exceeded");
    expect(check.diff.changes).toEqual([]);
  });
});
