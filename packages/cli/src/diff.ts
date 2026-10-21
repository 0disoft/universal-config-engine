import { buildConfigDiff, checkConfigChanges } from "@0disoft/universal-config-engine-core";
import { formatDiff } from "./diff-output.js";
import type { ParsedInspectionArgs } from "./args.js";
import { exitCodeForIssues } from "./exit-codes.js";
import { declarationFailure, executeDeclaration } from "./execution.js";
import type { CliResult, CliRuntime } from "./types.js";
import { loadChangePolicy, formatChangeCheck } from "./change-policy.js";
import type { PipelineDeclarationReadPolicy } from "./pipeline.js";

export async function runDiffCli(parsed: ParsedInspectionArgs, runtime: CliRuntime, readPolicy: PipelineDeclarationReadPolicy = {}): Promise<CliResult> {
  const policy = parsed.policy === undefined ? undefined : await loadChangePolicy(parsed.policy, runtime.cwd);
  async function load(path: string) {
    if (policy !== undefined && policy.issues.length > 0) return { ...declarationFailure(undefined), issues: policy.issues };
    try { return (await executeDeclaration(path, runtime, parsed.sourceArgv, true, readPolicy)).result; }
    catch (error) { return declarationFailure(error); }
  }
  // Deliberately sequential: declarations can use stateful application adapters.
  const before = await load(parsed.configPath);
  const after = await load(parsed.against!);
  if (policy !== undefined) {
    const check = checkConfigChanges(before, after, policy.value, {
      ...(parsed.detectSecretChanges === undefined ? {} : { detectSecretChanges: parsed.detectSecretChanges })
    });
    runtime.stdout(formatChangeCheck(check, parsed.output === "json"));
    const issues = [...check.diff.before.diagnostics.issues, ...check.diff.after.diagnostics.issues];
    return { exitCode: check.status === "ok" ? 0 : check.diff.status === "error" ? exitCodeForIssues(issues)
      : check.policy.violations.some((violation) => violation.code === "invalid_policy") ? 4 : 3 };
  }
  const report = buildConfigDiff(before, after, {
    ...(parsed.path === undefined ? {} : { path: parsed.path }),
    ...(parsed.detectSecretChanges === undefined ? {} : { detectSecretChanges: parsed.detectSecretChanges })
  });
  runtime.stdout(formatDiff(report, parsed.output === "json"));
  const issues = [...report.before.diagnostics.issues, ...report.after.diagnostics.issues];
  return { exitCode: report.status === "ok" ? 0 : exitCodeForIssues(issues) };
}
