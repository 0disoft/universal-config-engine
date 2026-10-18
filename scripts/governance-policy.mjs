export function evaluateGovernance(input) {
  const checks = [];
  function check(id, evidence, evaluate) {
    if (evidence?.status !== "known") {
      checks.push({ id, status: "unknown", reason: "API evidence unavailable; verify feature visibility and read permissions." });
      return;
    }
    let ok = false;
    try { ok = evaluate(evidence.value) === true; } catch { /* malformed evidence fails closed */ }
    checks.push({ id, status: ok ? "pass" : "fail" });
  }
  check("preparation-commit", input.mainCommit, (sha) =>
    /^[0-9a-f]{40}$/.test(input.commitSha) && sha === input.commitSha);
  check("action-sha-pinning", input.actionsPolicy, (policy) =>
    policy.enabled === true && policy.sha_pinning_required === true);
  check("main-ruleset", input.rulesets, (rulesets) => rulesets.some((rule) =>
    isRuleset(rule, "branch", "~DEFAULT_BRANCH", ["deletion", "non_fast_forward", "required_linear_history"])));
  check("main-effective-rules", input.mainRules, (rules) =>
    exactRuleTypes(rules, ["deletion", "non_fast_forward", "required_linear_history"]));
  check("release-tag-ruleset", input.rulesets, (rulesets) => rulesets.some((rule) =>
    isRuleset(rule, "tag", "refs/tags/v*", ["deletion", "update"])));
  for (const kind of ["codeScanning", "dependabot", "secretScanning"]) {
    check(`${kind}-alerts`, input[kind], (count) => Number.isSafeInteger(count) && count === 0);
  }
  return {
    schemaVersion: "1", repository: input.repository, commitSha: input.commitSha,
    ok: checks.every((entry) => entry.status === "pass"), checks
  };
}

function isRuleset(rule, target, pattern, types) {
  const names = rule.conditions?.ref_name;
  return rule.enforcement === "active" && rule.target === target &&
    Array.isArray(rule.bypass_actors) && rule.bypass_actors.length === 0 &&
    names?.include?.length === 1 && names.include[0] === pattern &&
    Array.isArray(names.exclude) && names.exclude.length === 0 &&
    Object.keys(rule.conditions).length === 1 && exactRuleTypes(rule.rules, types);
}

function exactRuleTypes(rules, expected) {
  return Array.isArray(rules) && rules.length === expected.length &&
    expected.every((type) => rules.some((rule) => rule.type === type));
}
