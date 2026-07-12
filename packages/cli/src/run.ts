import {
  buildDiagnosticReport,
  combineConfigIssues,
  type ConfigIssue,
  runValidators,
  resolveConfig
} from "@0disoft/universal-config-engine-core";
import { getCliUsageContext, parseCliArgs } from "./args.js";
import {
  EXIT_USAGE_ERROR,
  exitCodeForResult
} from "./exit-codes.js";
import { formatHumanReport, formatJsonReport } from "./output.js";
import {
  loadDeclaredSources,
  loadPipelineDeclarationContext,
  sourceLoadFailedIssues
} from "./pipeline.js";
import { createDeclaredValidators } from "./validators.js";
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

  try {
    const declarationContext = await loadPipelineDeclarationContext(parsed.configPath, runtime.cwd);
    const declaration = declarationContext.declaration;
    const sources = await loadDeclaredSources({
      declaration,
      configPath: declarationContext.canonicalConfigPath,
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
    const issues = sourceLoadFailedIssues(error);
    const failureResult = {
      ok: false,
      config: {},
      sources: [],
      issues,
      provenance: [],
      resolvedPaths: [],
      limits: {
        maxDepth: 0,
        maxKeyCount: 0,
        maxPathLength: 0,
        maxDiagnostics: Math.max(1, issues.length)
      }
    } as const;
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
      maxDiagnostics: 1
    }
  });
}

async function applyDeclaredValidation(
  result: ReturnType<typeof resolveConfig>,
  declaration: Awaited<ReturnType<typeof loadPipelineDeclarationContext>>["declaration"]
): Promise<ReturnType<typeof resolveConfig>> {
  const declaredValidators = createDeclaredValidators(declaration);
  const setupIssues = declaredValidators.issues;
  const setupCombinedIssues = combineConfigIssues(
    result.issues,
    setupIssues,
    result.limits.maxDiagnostics
  );

  if (!result.ok || setupIssues.some((issue) => issue.severity === "error")) {
    return {
      ...result,
      ok: !setupCombinedIssues.some((issue) => issue.severity === "error"),
      issues: setupCombinedIssues
    };
  }

  const validation = await runValidators({
    config: result.config,
    provenance: result.provenance,
    validators: declaredValidators.validators,
    ...(declaration.limits === undefined ? {} : { limits: declaration.limits })
  });
  const issues = combineConfigIssues(
    setupCombinedIssues,
    validation.issues,
    result.limits.maxDiagnostics
  );

  return {
    ...result,
    ok: !issues.some((issue) => issue.severity === "error"),
    issues,
    provenance: [...result.provenance, ...validation.provenance]
  };
}
