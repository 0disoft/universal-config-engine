import { execFileSync } from "node:child_process";

function ghRequest(path, paginate = false) {
  const args = ["api", path];
  if (paginate) args.push("--paginate", "--slurp");
  return JSON.parse(execFileSync("gh", args, {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 8 * 1024 * 1024,
    timeout: 30_000
  }));
}

export function collectGovernance({ repository, commitSha }, request = ghRequest) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !/^[0-9a-f]{40}$/.test(commitSha)) {
    throw new Error("Governance preflight requires owner/name and a full preparation commit SHA.");
  }
  const root = `repos/${repository}`;
  const known = (read) => {
    try { return { status: "known", value: read() }; }
    catch { return { status: "unknown" }; }
  };
  const allPages = (path) => {
    const pages = request(path, true);
    if (!Array.isArray(pages) || !pages.every(Array.isArray)) throw new Error("Invalid API pagination.");
    return pages.flat();
  };
  return {
    repository, commitSha,
    mainCommit: known(() => {
      const repo = request(root);
      return request(`${root}/git/ref/heads/${encodeURIComponent(repo.default_branch)}`).object.sha;
    }),
    actionsPolicy: known(() => request(`${root}/actions/permissions`)),
    rulesets: known(() => allPages(`${root}/rulesets?includes_parents=true&per_page=100`)
      .map((rule) => request(`${root}/rulesets/${rule.id}`))),
    mainRules: known(() => {
      const repo = request(root);
      return allPages(`${root}/rules/branches/${encodeURIComponent(repo.default_branch)}?per_page=100`);
    }),
    codeScanning: known(() => allPages(`${root}/code-scanning/alerts?state=open&per_page=100`).length),
    dependabot: known(() => allPages(`${root}/dependabot/alerts?state=open&per_page=100`).length),
    secretScanning: known(() => allPages(`${root}/secret-scanning/alerts?state=open&per_page=100`).length)
  };
}
