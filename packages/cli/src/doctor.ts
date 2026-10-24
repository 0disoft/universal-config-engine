import { buildDiagnosticReport, type ConfigIssue, type DiagnosticReport } from "@0disoft/universal-config-engine-core";
import { getCliUsageContext, parseInspectionArgs } from "./args.js";
import { prepareDiscoveryArgs } from "./discovery.js";
import { declarationFailure, executeDeclaration } from "./execution.js";
import { exitCodeForResult } from "./exit-codes.js";
import { PipelineDeclarationError } from "./pipeline.js";
import type { CliResult, CliRuntime } from "./types.js";
import { formatPublicReport } from "./public-output.js";

export interface DoctorFix { readonly code: string; readonly action: string }
export interface DoctorReport {
  readonly schemaVersion: "doctor-1";
  readonly command: "doctor";
  readonly status: "ok" | "error";
  readonly diagnostics: DiagnosticReport;
  readonly fixes: readonly DoctorFix[];
}

export async function runDoctorCli(args: readonly string[], runtime: CliRuntime, publicMode = false): Promise<CliResult> {
  const separator = args.indexOf("--");
  const options = separator < 0 ? args : args.slice(0, separator);
  let json = getCliUsageContext(["validate", ...args.slice(1)]).output === "json";
  let pipeline;
  try {
    let selected;
    let parsed;
    try {
      if (options.some(arg => ["--values", "--path", "--against", "--policy", "--detect-secret-changes"]
        .some(flag => arg === flag || arg.startsWith(`${flag}=`)))) throw new Error("Invalid doctor options.");
      selected = await prepareDiscoveryArgs(["validate", ...args.slice(1)], runtime);
      parsed = parseInspectionArgs(selected.args);
      json = parsed.output === "json";
    } catch {
      throw new PipelineDeclarationError([{ category: "usage", code: "cli_usage_error", severity: "error",
        message: "Use doctor with --config or --discover and optional --profile, --workspace and --json." }]);
    }
    if (selected.issues !== undefined) throw new PipelineDeclarationError(selected.issues);
    pipeline = await executeDeclaration(parsed.configPath, runtime, parsed.sourceArgv, true, {
      ...(selected.workspacePath === undefined ? {} : { allowedRootPath: selected.workspacePath, workspacePath: selected.workspacePath }),
      ...(selected.profile === undefined ? {} : { profile: selected.profile })
    });
  } catch (error) {
    const result = declarationFailure(error);
    pipeline = { result, report: buildDiagnosticReport(result) };
  }
  const fixes = new Map<string, DoctorFix>();
  if (publicMode) {
    const projected = formatPublicReport(pipeline.report);
    runtime.stdout(projected.output);
    return { exitCode: !pipeline.result.ok ? exitCodeForResult(pipeline.result) : projected.status === "ok" ? 0 : 3 };
  }
  for (const issue of pipeline.report.issues) {
    const fix = fixForIssue(issue); fixes.set(fix.code, fix);
  }
  const report: DoctorReport = { schemaVersion: "doctor-1", command: "doctor", status: pipeline.report.status,
    diagnostics: pipeline.report, fixes: [...fixes.values()] };
  runtime.stdout(json ? `${JSON.stringify(report, null, 2)}\n` :
    `Configuration doctor: ${report.status}\n${report.diagnostics.issues.map(formatDoctorIssue).join("")}${report.fixes.map(fix => `- ${fix.action}\n`).join("")}${report.status === "ok" ? "No configuration errors found.\n" : ""}`);
  return { exitCode: exitCodeForResult({ ...pipeline.result, ok: pipeline.result.ok && report.status === "ok", issues: pipeline.report.issues }) };
}

function formatDoctorIssue(issue: ConfigIssue): string {
  const path = issue.path === undefined ? "" : ` at ${JSON.stringify(issue.path)}`;
  const origin = issue.validatorId !== undefined ? ` validator ${JSON.stringify(issue.validatorId)}`
    : issue.sourceId === undefined ? "" : ` source ${JSON.stringify(issue.sourceId)}`;
  const constraint = issue.constraint === undefined ? "" : ` constraint ${JSON.stringify(issue.constraint)}`;
  return `- ${issue.severity} ${JSON.stringify(issue.code)}${path}${origin}${constraint}: ${JSON.stringify(issue.message)}\n`;
}

function fixForIssue(issue: ConfigIssue): DoctorFix {
  if (issue.code === "pipeline_profile_not_found") return { code: "select_declared_profile", action: "Select a profile declared in this configuration graph, or omit --profile for base settings." };
  if (issue.code === "config_not_found") return { code: "create_declaration", action: "Run uce init in the intended directory, or provide an explicit --config path inside the workspace." };
  if (issue.code.includes("outside_") || issue.code === "pipeline_workspace_policy_conflict") return {
    code: "check_workspace", action: "Keep declarations and file sources inside the selected workspace; check symlinks and origin-relative paths." };
  if (issue.code === "pipeline_inheritance_cycle") return { code: "remove_inheritance_cycle", action: "Remove circular extends references; each declaration may inherit only from its ancestors." };
  switch (issue.category) {
    case "usage": return { code: "check_usage", action: "Use uce doctor --config <file> or --discover <workspace>; select profiles explicitly." };
    case "resource-limit": return { code: "reduce_input", action: "Reduce the reported input size or count; raise configurable limits only after reviewing the workload. Inheritance file and byte caps are fixed." };
    case "parse": return { code: "fix_file_syntax", action: "Check file syntax, explicit format, duplicate keys and supported JSON-compatible values. Parser exception text is intentionally omitted." };
    case "validation": return { code: "fix_schema_input", action: "Compare the reported validation paths with the declared schema and correct missing or invalid settings." };
    case "coercion": return { code: "fix_conversion", action: "Check the conversion target, path and input value; coercion is explicit and does not replace schema validation." };
    case "mapping": return { code: "fix_mapping", action: "Check explicit environment/argv mapping names, paths and parseAs types; no implicit mapping is performed." };
    default: return { code: "check_declaration_and_sources", action: "Check declaration fields, unique ids, file existence and read permissions. File paths use their declaring file's directory." };
  }
}
