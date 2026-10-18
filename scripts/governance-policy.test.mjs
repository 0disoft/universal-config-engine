import assert from "node:assert/strict";
import test from "node:test";
import { collectGovernance } from "./collect-governance.mjs";
import { evaluateGovernance } from "./governance-policy.mjs";

const sha = "a".repeat(40);
const known = (value) => ({ status: "known", value });
function ruleset(target, pattern, types) {
  return { target, enforcement: "active", bypass_actors: [],
    conditions: { ref_name: { include: [pattern], exclude: [] } },
    rules: types.map((type) => ({ type })) };
}
function fixture() {
  const main = ["deletion", "non_fast_forward", "required_linear_history"];
  return {
    repository: "owner/repo", commitSha: sha, mainCommit: known(sha),
    actionsPolicy: known({ enabled: true, sha_pinning_required: true }),
    mainRules: known(main.map((type) => ({ type }))),
    rulesets: known([ruleset("branch", "~DEFAULT_BRANCH", main), ruleset("tag", "refs/tags/v*", ["deletion", "update"])]),
    codeScanning: known(0), dependabot: known(0), secretScanning: known(0)
  };
}
test("accepts the documented solo-maintainer governance", () => {
  assert.equal(evaluateGovernance(fixture()).ok, true);
});
test("fails closed on missing or unknown evidence and nonzero or malformed alert counts", () => {
  for (const key of ["mainCommit", "actionsPolicy", "rulesets", "mainRules", "codeScanning", "dependabot", "secretScanning"]) {
    for (const evidence of [undefined, { status: "unknown" }, known(null)]) {
      assert.equal(evaluateGovernance({ ...fixture(), [key]: evidence }).ok, false);
    }
  }
  for (const value of [1, -1, "0", 0.5]) {
    assert.equal(evaluateGovernance({ ...fixture(), dependabot: known(value) }).ok, false);
  }
});
test("rejects inactive, missing, excluded, bypassed and behavior-changing rulesets", () => {
  for (const mutate of [
    (rules) => rules.pop(),
    (rules) => { rules[0].enforcement = "evaluate"; },
    (rules) => { rules[0].bypass_actors.push({ actor_type: "RepositoryRole", actor_id: 5 }); },
    (rules) => { rules[0].conditions.ref_name.exclude.push("refs/heads/main"); },
    (rules) => { rules[0].rules.push({ type: "pull_request" }); },
    (rules) => { rules[1].rules.pop(); }
  ]) {
    const input = fixture(); mutate(input.rulesets.value);
    assert.equal(evaluateGovernance(input).ok, false);
  }
});
test("rejects disabled SHA policy, wrong preparation identity and effective PR gates", () => {
  const input = fixture(); input.actionsPolicy.value.sha_pinning_required = false;
  assert.equal(evaluateGovernance(input).ok, false);
  input.actionsPolicy.value.sha_pinning_required = true;
  input.mainCommit = known("b".repeat(40));
  assert.equal(evaluateGovernance(input).ok, false);
  input.mainCommit = known(sha); input.mainRules.value.push({ type: "pull_request" });
  assert.equal(evaluateGovernance(input).ok, false);
});
test("API permission failures remain unknown and never become empty alert counts", () => {
  const input = collectGovernance({ repository: "owner/repo", commitSha: sha }, () => {
    throw new Error("403 private response text");
  });
  const result = evaluateGovernance(input);
  assert(result.checks.every((entry) => entry.status === "unknown"));
  assert(!JSON.stringify(result).includes("private response text"));
});
