import { execFileSync } from "node:child_process";
import { collectGovernance } from "./collect-governance.mjs";
import { evaluateGovernance } from "./governance-policy.mjs";

const args = process.argv.slice(2).filter((value) => value !== "--");
const options = new Map();
for (let index = 0; index < args.length; index += 2) {
  if (!["--repository", "--commit"].includes(args[index]) || !args[index + 1]) {
    throw new Error("Use --repository owner/name and --commit full-sha.");
  }
  options.set(args[index], args[index + 1]);
}
const repository = options.get("--repository") ?? "0disoft/universal-config-engine";
const commitSha = options.get("--commit") ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const result = evaluateGovernance(collectGovernance({ repository, commitSha }));
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.ok ? 0 : 1;
