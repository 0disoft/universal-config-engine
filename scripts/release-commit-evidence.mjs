export const REQUIRED_RELEASE_WORKFLOWS = [
  ".github/workflows/ci.yml",
  ".github/workflows/codeql.yml",
  ".github/workflows/consumer-compatibility.yml",
  ".github/workflows/runtime-compatibility.yml"
];

export function evaluateReleaseCommitEvidence(input) {
  for (const sha of [input.expectedCandidateCommitSha, input.candidateCommitSha, input.preparationSha]) {
    if (typeof sha !== "string" || !/^[0-9a-f]{40}$/.test(sha)) {
      throw new Error("Release evidence requires full candidate and preparation commit SHAs.");
    }
  }
  if (input.candidateCommitSha !== input.expectedCandidateCommitSha) {
    throw new Error("Candidate tag does not resolve to the expected candidate commit SHA.");
  }
  for (const path of REQUIRED_RELEASE_WORKFLOWS) {
    const runs = (input.workflowRuns ?? []).filter((run) =>
      run.path === path && run.head_sha === input.preparationSha && run.event === "push");
    const latest = runs.sort((a, b) => b.id - a.id || b.run_attempt - a.run_attempt)[0];
    if (latest?.status !== "completed" || latest.conclusion !== "success") {
      throw new Error(`Required workflow ${path} must complete successfully on the exact preparation SHA.`);
    }
  }
}

export async function peelCommitRef(reference, readTag) {
  let object = reference;
  for (let depth = 0; depth < 8; depth += 1) {
    if (!object || !/^[0-9a-f]{40}$/.test(object.sha)) break;
    if (object.type === "commit") return object.sha;
    if (object.type !== "tag") break;
    object = (await readTag(object.sha)).object;
  }
  throw new Error("Candidate tag could not be resolved to a bounded exact commit.");
}

export async function collectReleaseCommitEvidence({ candidateTag, preparationSha, fetchGitHub }) {
  const reference = await fetchGitHub(`git/ref/tags/${encodeURIComponent(candidateTag)}`);
  const candidateCommitSha = await peelCommitRef(reference.object,
    (sha) => fetchGitHub(`git/tags/${sha}`));
  const pages = await Promise.all(REQUIRED_RELEASE_WORKFLOWS.map((path) =>
    fetchGitHub(`actions/workflows/${path.split("/").at(-1)}/runs?head_sha=${encodeURIComponent(preparationSha)}&event=push&per_page=100`)));
  return { candidateCommitSha, preparationSha, workflowRuns: pages.flatMap((page) => page.workflow_runs) };
}
