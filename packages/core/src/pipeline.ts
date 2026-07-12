import { loadConfigSources } from "./loader.js";
import { resolveConfig } from "./merge.js";
import {
  buildDiagnosticReport,
  type BuildDiagnosticReportOptions
} from "./redaction.js";
import type {
  CoercionRule,
  ConfigIssue,
  ConfigLoader,
  ConfigResult,
  DiagnosticReport,
  MergePolicy,
  ResourceLimitPolicy,
  ValidatorAdapter
} from "./types.js";
import { runValidators } from "./validation.js";

export interface RunConfigPipelineInput<TContext = undefined> {
  readonly loaders: readonly ConfigLoader<TContext>[];
  readonly context: TContext;
  readonly validators?: readonly ValidatorAdapter[];
  readonly mergePolicy?: Partial<MergePolicy>;
  readonly limits?: Partial<ResourceLimitPolicy>;
  readonly coercionRules?: readonly CoercionRule[];
  readonly reportOptions?: BuildDiagnosticReportOptions;
}

export interface RunConfigPipelineResult {
  readonly result: ConfigResult;
  readonly report: DiagnosticReport;
}

export async function runConfigPipeline<TContext = undefined>(
  input: RunConfigPipelineInput<TContext>
): Promise<RunConfigPipelineResult> {
  const loaded = await loadConfigSources({
    loaders: input.loaders,
    context: input.context,
    ...(input.limits === undefined ? {} : { limits: input.limits })
  });
  const resolved = resolveConfig({
    sources: loaded.sources,
    ...(input.mergePolicy === undefined ? {} : { mergePolicy: input.mergePolicy }),
    ...(input.limits === undefined ? {} : { limits: input.limits }),
    ...(input.coercionRules === undefined ? {} : { coercionRules: input.coercionRules })
  });
  const result = await applyPipelineValidators(resolved, input.validators ?? []);

  return {
    result,
    report: buildDiagnosticReport(result, input.reportOptions)
  };
}

async function applyPipelineValidators(
  result: ConfigResult,
  validators: readonly ValidatorAdapter[]
): Promise<ConfigResult> {
  if (!result.ok || validators.length === 0) {
    return result;
  }

  const validation = await runValidators({
    config: result.config,
    provenance: result.provenance,
    validators,
    limits: result.limits
  });
  const issues = combineConfigIssues(
    result.issues,
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

export function combineConfigIssues(
  existing: readonly ConfigIssue[],
  next: readonly ConfigIssue[],
  declaredMaxDiagnostics: number
): readonly ConfigIssue[] {
  const maxDiagnostics = Math.max(1, declaredMaxDiagnostics);
  const combined = [...existing.slice(0, maxDiagnostics)];

  for (const issue of next) {
    if (combined.length >= maxDiagnostics) {
      replaceLastIssueWithOverflowMarker(combined, maxDiagnostics);
      break;
    }
    combined.push(issue);
  }

  return combined;
}

function replaceLastIssueWithOverflowMarker(issues: ConfigIssue[], maxDiagnostics: number): void {
  if (issues.some(isDiagnosticsOverflowMarker)) {
    return;
  }

  const marker: ConfigIssue = {
    category: "resource-limit",
    code: "max_diagnostics_exceeded",
    severity: "error",
    message: `Diagnostics exceeded the maximum of ${maxDiagnostics}.`
  };

  if (issues.length === 0) {
    issues.push(marker);
    return;
  }

  issues[issues.length - 1] = marker;
}

function isDiagnosticsOverflowMarker(issue: ConfigIssue): boolean {
  return issue.category === "resource-limit" && issue.code === "max_diagnostics_exceeded";
}
