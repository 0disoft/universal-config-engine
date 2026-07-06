import {
  buildDiagnosticReport,
  runValidators,
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
import { createDeclaredValidators } from "./validators.js";
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
    const finalResult =
      parsed.command === "validate"
        ? await applyDeclaredValidation(result, declaration)
        : result;
    const report = buildDiagnosticReport(finalResult);
    const output =
      parsed.output === "json"
        ? formatJsonReport(parsed.command, report)
        : formatHumanReport(parsed.command, report);
    runtime.stdout(output);
    return { exitCode: exitCodeForResult(finalResult) };
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

async function applyDeclaredValidation(
  result: ReturnType<typeof resolveConfig>,
  declaration: Awaited<ReturnType<typeof loadPipelineDeclaration>>
): Promise<ReturnType<typeof resolveConfig>> {
  const declaredValidators = createDeclaredValidators(declaration);
  const setupIssues = declaredValidators.issues;

  if (!result.ok || setupIssues.some((issue) => issue.severity === "error")) {
    const issues = [...result.issues, ...setupIssues];
    return {
      ...result,
      ok: !issues.some((issue) => issue.severity === "error"),
      issues
    };
  }

  const validation = await runValidators({
    config: result.config,
    provenance: result.provenance,
    validators: declaredValidators.validators
  });
  const issues = [...result.issues, ...setupIssues, ...validation.issues];

  return {
    ...result,
    ok: !issues.some((issue) => issue.severity === "error"),
    issues,
    provenance: [...result.provenance, ...validation.provenance]
  };
}
