import {
  buildDiagnosticReport, combineConfigIssues, runConfigPipeline,
  type ConfigLoader, type ConfigResult, type LoadedSource, type RunConfigPipelineResult
} from "@0disoft/universal-config-engine-core";
import { loadDeclaredSources, loadPipelineDeclarationContext, sourceLoadFailedIssues } from "./pipeline.js";
import { createDeclaredValidators } from "./validators.js";
import type { CliRuntime } from "./types.js";

/** One pipeline implementation for legacy commands, inspection and both diff sides. */
export async function executeDeclaration(configPath: string, runtime: CliRuntime, argv: readonly string[], validate: boolean): Promise<RunConfigPipelineResult> {
  const context = await loadPipelineDeclarationContext(configPath, runtime.cwd);
  const declaration = context.declaration;
  const sources = await loadDeclaredSources({ declaration, configPath: context.canonicalConfigPath,
    cwd: runtime.cwd, env: runtime.env, argv });
  const declared = validate ? createDeclaredValidators(declaration) : { validators: [], issues: [] };
  const pipeline = await runConfigPipeline({
    loaders: sources.map(toLoadedSourceAdapter), context: undefined,
    validators: declared.issues.some((issue) => issue.severity === "error") ? [] : declared.validators,
    ...(declaration.coercionRules === undefined ? {} : { coercionRules: declaration.coercionRules }),
    ...(declaration.limits === undefined ? {} : { limits: declaration.limits })
  });
  if (declared.issues.length === 0) return pipeline;
  const issues = combineConfigIssues(pipeline.result.issues, declared.issues, pipeline.result.limits.maxDiagnostics);
  const result = { ...pipeline.result, ok: !issues.some((issue) => issue.severity === "error"), issues };
  return { result, report: buildDiagnosticReport(result) };
}

export function declarationFailure(error: unknown): ConfigResult {
  const issues = sourceLoadFailedIssues(error);
  return {
    ok: false, config: {}, sources: [], issues, provenance: [], resolvedPaths: [],
    limits: { maxDepth: 0, maxKeyCount: 0, maxPathLength: 0, maxDiagnostics: Math.max(1, issues.length),
      maxSources: 1, maxProvenanceEvents: 1, maxResolvedPaths: 1, maxReportBytes: 4 * 1024 * 1024 }
  };
}

function toLoadedSourceAdapter(source: LoadedSource): ConfigLoader {
  return { descriptor: source.descriptor, load: () => ({ value: source.value,
    ...(source.issues === undefined ? {} : { issues: source.issues }),
    ...(source.locations === undefined ? {} : { locations: source.locations }) }) };
}
