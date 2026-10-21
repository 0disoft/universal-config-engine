import {
  buildDiagnosticReport,
  buildConfigInspection,
  type ConfigIssue
} from "@0disoft/universal-config-engine-core";
import { getCliUsageContext, parseCliArgs } from "./args.js";
import {
  EXIT_USAGE_ERROR,
  exitCodeForResult
} from "./exit-codes.js";
import { formatHumanReport, formatJsonReport } from "./output.js";
import { formatInspection } from "./inspection-output.js";
import { declarationFailure, executeDeclaration } from "./execution.js";
import { runDiffCli } from "./diff.js";
import type { CliResult, CliRuntime } from "./types.js";

export async function runCli(args: readonly string[], runtime: CliRuntime): Promise<CliResult> {
  let parsed;
  try {
    parsed = parseCliArgs(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid CLI arguments.";
    const usageContext = getCliUsageContext(args);
    if (usageContext.output === "json" && usageContext.command !== undefined) {
      runtime.stdout(formatJsonReport(usageContext.command, buildUsageErrorReport(message)));
    } else {
      runtime.stderr(`${message}\n`);
    }
    return { exitCode: EXIT_USAGE_ERROR };
  }

  if (parsed.command === "diff") return runDiffCli(parsed, runtime);
  try {
    const { result: finalResult, report } = await executeDeclaration(parsed.configPath, runtime, parsed.sourceArgv, parsed.command === "validate" || parsed.values === true);
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
    return { exitCode: exitCodeForResult(finalResult) };
  } catch (error) {
    const failureResult = declarationFailure(error);
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
