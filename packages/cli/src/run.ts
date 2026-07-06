import {
  buildDiagnosticReport,
  resolveConfig
} from "@universal-config-engine/core";
import { parseCliArgs } from "./args.js";
import {
  EXIT_SOURCE_FAILED,
  EXIT_USAGE_ERROR,
  exitCodeForResult
} from "./exit-codes.js";
import { formatHumanReport, formatJsonReport } from "./output.js";
import {
  loadDeclaredSources,
  loadPipelineDeclaration,
  sourceLoadFailedIssue
} from "./pipeline.js";
import type { CliResult, CliRuntime } from "./types.js";

export async function runCli(args: readonly string[], runtime: CliRuntime): Promise<CliResult> {
  let parsed;
  try {
    parsed = parseCliArgs(args);
  } catch (error) {
    runtime.stderr(`${error instanceof Error ? error.message : "Invalid CLI arguments."}\n`);
    return { exitCode: EXIT_USAGE_ERROR };
  }

  try {
    const declaration = await loadPipelineDeclaration(parsed.configPath, runtime.cwd);
    const sources = await loadDeclaredSources({
      declaration,
      configPath: parsed.configPath,
      cwd: runtime.cwd,
      env: runtime.env,
      argv: parsed.sourceArgv
    });
    const result = resolveConfig({
      sources,
      ...(declaration.coercionRules === undefined ? {} : { coercionRules: declaration.coercionRules }),
      ...(declaration.limits === undefined ? {} : { limits: declaration.limits })
    });
    const report = buildDiagnosticReport(result);
    const output =
      parsed.output === "json"
        ? formatJsonReport(parsed.command, report)
        : formatHumanReport(parsed.command, report);
    runtime.stdout(output);
    return { exitCode: exitCodeForResult(result) };
  } catch (error) {
    const issue = sourceLoadFailedIssue(error);
    const report = buildDiagnosticReport({
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
        maxDiagnostics: 1
      }
    });
    const output =
      parsed.output === "json"
        ? formatJsonReport(parsed.command, report)
        : formatHumanReport(parsed.command, report);
    runtime.stdout(output);
    return { exitCode: EXIT_SOURCE_FAILED };
  }
}
