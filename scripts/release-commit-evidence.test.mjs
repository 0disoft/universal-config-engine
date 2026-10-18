import assert from "node:assert/strict";
import test from "node:test";
import { evaluateReleaseCommitEvidence, peelCommitRef, REQUIRED_RELEASE_WORKFLOWS } from "./release-commit-evidence.mjs";

const candidate = "a".repeat(40);
const preparation = "b".repeat(40);
function fixture() {
  return {
    expectedCandidateCommitSha: candidate, candidateCommitSha: candidate, preparationSha: preparation,
    workflowRuns: REQUIRED_RELEASE_WORKFLOWS.map((path, id) => ({
      id, run_attempt: 1, path, head_sha: preparation, event: "push", status: "completed", conclusion: "success"
    }))
  };
}
test("accepts exact candidate and preparation identities", () => {
  assert.doesNotThrow(() => evaluateReleaseCommitEvidence(fixture()));
});
test("rejects missing or mismatched full candidate and preparation SHAs", () => {
  for (const change of [{ candidateCommitSha: preparation }, { preparationSha: undefined }, { expectedCandidateCommitSha: "abc" }]) {
    assert.throws(() => evaluateReleaseCommitEvidence({ ...fixture(), ...change }));
  }
});
for (const state of ["queued", "in_progress", "skipped", "cancelled", "failure"]) {
  test(`rejects ${state} workflow evidence`, () => {
    const input = fixture();
    input.workflowRuns[0].status = ["queued", "in_progress"].includes(state) ? state : "completed";
    input.workflowRuns[0].conclusion = state;
    assert.throws(() => evaluateReleaseCommitEvidence(input), /exact preparation SHA/);
  });
}
test("rejects absent, stale, renamed and non-push evidence", () => {
  for (const change of [undefined, { head_sha: candidate }, { path: "another.yml" }, { event: "pull_request" }]) {
    const input = fixture();
    if (change === undefined) input.workflowRuns.shift();
    else Object.assign(input.workflowRuns[0], change);
    assert.throws(() => evaluateReleaseCommitEvidence(input));
  }
});
test("does not accept an older green run or attempt over a newer failure", () => {
  for (const change of [{ id: 100 }, { run_attempt: 2 }]) {
    const input = fixture();
    input.workflowRuns.push({ ...input.workflowRuns[0], ...change, conclusion: "failure" });
    assert.throws(() => evaluateReleaseCommitEvidence(input));
  }
});
test("resolves lightweight and nested annotated tags and rejects invalid refs", async () => {
  assert.equal(await peelCommitRef({ type: "commit", sha: candidate }, () => assert.fail()), candidate);
  assert.equal(await peelCommitRef({ type: "tag", sha: preparation }, async () => ({ object: { type: "commit", sha: candidate } })), candidate);
  await assert.rejects(() => peelCommitRef({ type: "tree", sha: candidate }, () => assert.fail()));
  await assert.rejects(() => peelCommitRef({ type: "tag", sha: candidate }, async () => ({ object: { type: "tag", sha: candidate } })));
});
