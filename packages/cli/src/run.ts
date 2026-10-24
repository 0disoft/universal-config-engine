import {
  buildDiagnosticReport,
  buildConfigInspection,
  type ConfigIssue
} from "@0disoft/universal-config-engine-core";
import { getCliUsageContext, parseInspectionArgs } from "./args.js";
import {
  EXIT_USAGE_ERROR,
  exitCodeForIssues,
  exitCodeForResult
} from "./exit-codes.js";
import { formatHumanReport, formatJsonReport } from "./output.js";
import { formatInspection } from "./inspection-output.js";
import { declarationFailure, executeDeclaration } from "./execution.js";
import { runDiffCli } from "./diff.js";
import { prepareDiscoveryArgs } from "./discovery.js";
import { PipelineDeclarationError } from "./pipeline.js";
import type { CliResult, CliRuntime } from "./types.js";
import { runInitCli } from "./init.js";
import { runDoctorCli } from "./doctor.js";
import { formatPublicReport } from "./public-output.js";
import { runInformationCli } from "./information.js";

export async function runCli(args: readonly string[], runtime: CliRuntime): Promise<CliResult> {
  const information = await runInformationCli(args, runtime);
  if (information !== undefined) return information;
  const separator = args.indexOf("--");
  const options = separator < 0 ? args : args.slice(0, separator);
  const publicMode = options.includes("--public");
  if (publicMode) {
    if (!["explain", "validate", "doctor"].includes(args[0] ?? "") || options.filter(arg => arg === "--public").length !== 1 ||
        options.some(arg => ["--values", "--path"].some(flag => arg === flag || arg.startsWith(`${flag}=`)))) {
      runtime.stdout(formatPublicReport(buildUsageErrorReport("Public reports require explain, validate or doctor without value/path inspection.")).output);
      return { exitCode: EXIT_USAGE_ERROR };
    }
    args = [...options.filter(arg => arg !== "--public"), ...(separator < 0 ? [] : args.slice(separator))];
  }
  if (args[0] === "init") return runInitCli(args, runtime);
  if (args[0] === "doctor") return runDoctorCli(args, runtime, publicMode);
  let parsed;
  let selection;
  try {
    selection = await prepareDiscoveryArgs(args, runtime);
    parsed = parseInspectionArgs(selection.args);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid CLI arguments.";
    const usageContext = getCliUsageContext(args);
    if (publicMode) {
      runtime.stdout(formatPublicReport(buildUsageErrorReport("Invalid CLI arguments.")).output);
    } else if (usageContext.output === "json" && usageContext.command !== undefined) {
      const report = buildUsageErrorReport(message);
      runtime.stdout(usageContext.command === "diff" ? `${JSON.stringify({ command: "diff", ...report }, null, 2)}\n`
        : formatJsonReport(usageContext.command, report));
    } else {
      runtime.stderr(`${message}\n`);
    }
    return { exitCode: EXIT_USAGE_ERROR };
  }

  const readPolicy = { ...(selection.workspacePath === undefined ? {} : {
    allowedRootPath: selection.workspacePath, workspacePath: selection.workspacePath }),
    ...(selection.profile === undefined ? {} : { profile: selection.profile }) };
  if (parsed.command === "diff") return runDiffCli(parsed, runtime, readPolicy);
  try {
    if (selection.issues !== undefined) throw new PipelineDeclarationError(selection.issues);
    const { result: finalResult, report } = await executeDeclaration(parsed.configPath, runtime, parsed.sourceArgv, parsed.command === "validate" || parsed.values === true,
      readPolicy);
    if (publicMode) {
      const projected = formatPublicReport(report);
      runtime.stdout(projected.output);
      return { exitCode: !finalResult.ok ? exitCodeForResult(finalResult) : projected.status === "ok" ? 0 : 3 };
    }
    if (parsed.values === true) {
      const inspection = buildConfigInspection(finalResult, parsed.path === undefined ? {} : { path: parsed.path });
      runtime.stdout(formatInspection(inspection, parsed.output === "json"));
      return { exitCode: inspection.status === "ok" ? 0 : exitCodeForResult({ ...finalResult, ok: false, issues: inspection.diagnostics.issues }) };
    }
    const output =
      parsed.output === "json"
        ? formatJsonReport(parsed.command, report)
        : formatHumanReport(parsed.command, report);
    runtime.stdout(output);
    return { exitCode: !finalResult.ok ? exitCodeForResult(finalResult)
      : report.status === "ok" ? 0 : exitCodeForIssues(report.issues) };
  } catch (error) {
    const failureResult = declarationFailure(error);
    if (publicMode) {
      runtime.stdout(formatPublicReport(buildDiagnosticReport(failureResult)).output);
      return { exitCode: exitCodeForResult(failureResult) };
    }
    if (parsed.values === true) {
      runtime.stdout(formatInspection(buildConfigInspection(failureResult), parsed.output === "json"));
      return { exitCode: exitCodeForResult(failureResult) };
    }
    const report = buildDiagnosticReport(failureResult);
    const output =
      parsed.output === "json"
        ? formatJsonReport(parsed.command, report)
        : formatHumanReport(parsed.command, report);
    runtime.stdout(output);
    return { exitCode: exitCodeForResult(failureResult) };
  }
}
function buildUsageErrorReport(message: string) {
  const issue: ConfigIssue = {
    category: "usage",
    code: "cli_usage_error",
    severity: "error",
    message
  };

  return buildDiagnosticReport({
    ok: false,
    config: {},
    sources: [],
    issues: [issue],
    provenance: [],
    resolvedPaths: [],
    limits: {
      maxDepth: 0,
      maxKeyCount: 0,
      maxPathLength: 0,
      maxDiagnostics: 1,
      maxSources: 1,
      maxProvenanceEvents: 1,
      maxResolvedPaths: 1,
      maxReportBytes: 4 * 1024 * 1024
    }
  });
}
