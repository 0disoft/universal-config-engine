import {
  buildDiagnosticReport,
  combineConfigIssues,
  type ConfigLoader,
  type ConfigIssue,
  type ConfigResult,
  type LoadedSource,
  runConfigPipeline
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
    const declaredValidators =
      parsed.command === "validate"
        ? createDeclaredValidators(declaration)
        : { validators: [], issues: [] };
    const validators = declaredValidators.issues.some((issue) => issue.severity === "error")
      ? []
      : declaredValidators.validators;
    const pipeline = await runConfigPipeline({
      loaders: sources.map(toLoadedSourceAdapter),
      context: undefined,
      validators,
      ...(declaration.coercionRules === undefined ? {} : { coercionRules: declaration.coercionRules }),
      ...(declaration.limits === undefined ? {} : { limits: declaration.limits })
    });
    const finalResult = appendValidatorSetupIssues(pipeline.result, declaredValidators.issues);
    const report = declaredValidators.issues.length === 0
      ? pipeline.report
      : buildDiagnosticReport(finalResult);
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
        maxDiagnostics: Math.max(1, issues.length),
        maxSources: 1,
        maxProvenanceEvents: 1,
        maxResolvedPaths: 1,
        maxReportBytes: 4 * 1024 * 1024
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
      maxDiagnostics: 1,
      maxSources: 1,
      maxProvenanceEvents: 1,
      maxResolvedPaths: 1,
      maxReportBytes: 4 * 1024 * 1024
    }
  });
}

function appendValidatorSetupIssues(
  result: ConfigResult,
  setupIssues: readonly ConfigIssue[]
): ConfigResult {
  if (setupIssues.length === 0) {
    return result;
  }

  const issues = combineConfigIssues(
    result.issues,
    setupIssues,
    result.limits.maxDiagnostics
  );

  return {
    ...result,
    ok: !issues.some((issue) => issue.severity === "error"),
    issues
  };
}

function toLoadedSourceAdapter(source: LoadedSource): ConfigLoader {
  return {
    descriptor: source.descriptor,
    load() {
      return {
        value: source.value,
        ...(source.issues === undefined ? {} : { issues: source.issues }),
        ...(source.locations === undefined ? {} : { locations: source.locations })
      };
    }
  };
}
