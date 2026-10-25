import { dirname, resolve } from "node:path";
import {
  buildDiagnosticReport, combineConfigIssues, reportConfigOperationError, runConfigPipeline,
  runValidators, validateConfigOutput, type ConfigIssue, type ConfigLoader, type ConfigResult,
  type LoadedSource, type RunConfigPipelineResult, type RunValidatedConfigPipelineResult,
  type ValidatorAdapter, type BuildDiagnosticReportOptions
} from "@0disoft/universal-config-engine-core";
import { loadDeclaredSources, loadPipelineDeclarationContext, PipelineDeclarationError,
  sourceLoadFailedIssues, type PipelineDeclarationReadPolicy } from "./pipeline.js";
import { createDeclaredValidators, type DeclaredValidatorFactory } from "./declaration-validators.js";

export interface LoadConfigInput extends PipelineDeclarationReadPolicy {
  readonly configPath: string;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly argv?: readonly string[];
  /** Required only when the declaration has schemas; e.g. createAjvValidator. */
  readonly validatorFactory?: DeclaredValidatorFactory;
  /** Defaults to true. False is useful for provenance-only CLI explanations. */
  readonly validate?: boolean;
  readonly reportOptions?: BuildDiagnosticReportOptions;
}

/** Shared app/CLI execution: declared limits, coercion and validation cannot drift. */
export async function loadConfig(input: LoadConfigInput): Promise<RunConfigPipelineResult> {
  try {
    if (input.signal?.aborted) throw cancelled();
    const cwd = input.cwd ?? process.cwd();
    const context = await loadPipelineDeclarationContext(input.configPath, cwd, input);
    const declaration = context.declaration;
    const files = declaration.sources.flatMap(source =>
      source.kind === "json-file" || source.kind === "dotenv-file" || source.kind === "adapter"
        ? [resolve(dirname(context.sourceConfigPaths?.get(source.id) ?? context.canonicalConfigPath), source.path)] : []);
    if (files.length > 0) await input.onDependencies?.(files);
    const sources = await loadDeclaredSources({ declaration, configPath: context.canonicalConfigPath,
      cwd, env: input.env ?? process.env, argv: input.argv ?? [],
      ...(context.sourceConfigPaths === undefined ? {} : { sourceConfigPaths: context.sourceConfigPaths }),
      ...(context.workspacePath === undefined ? {} : { workspacePath: context.workspacePath }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      ...(input.onError === undefined ? {} : { onError: input.onError }) });
    const pipeline = await runConfigPipeline({
      loaders: sources.map(toLoadedSourceAdapter), context: undefined,
      ...(declaration.coercionRules === undefined ? {} : { coercionRules: declaration.coercionRules }),
      ...(declaration.limits === undefined ? {} : { limits: declaration.limits }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      ...(input.onError === undefined ? {} : { onError: input.onError }),
      ...(input.reportOptions === undefined ? {} : { reportOptions: input.reportOptions })
    });
    if (input.validate === false || !pipeline.result.ok || pipeline.report.status !== "ok") return pipeline;
    const remaining = pipeline.result.limits.maxProvenanceEvents - pipeline.result.provenance.length;
    const declared = (declaration.validators?.length ?? 0) > remaining
      ? { validators: [], issues: [{ category: "resource-limit", code: "max_provenance_events_exceeded", severity: "error",
          message: "Declared validators exceed the remaining provenance budget." }] as const }
      : createDeclaredValidators(declaration, input.validatorFactory, input);
    const validation = declared.issues.length > 0 || declared.validators.length === 0
      ? { issues: declared.issues, provenance: [] }
      : await runValidators({ config: pipeline.result.config, provenance: pipeline.result.provenance,
          validators: declared.validators, limits: pipeline.result.limits,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
          ...(input.onError === undefined ? {} : { onError: input.onError }) });
    const issues = combineConfigIssues(pipeline.result.issues, validation.issues, pipeline.result.limits.maxDiagnostics);
    const result = { ...pipeline.result, ok: !issues.some(issue => issue.severity === "error"), issues,
      provenance: [...pipeline.result.provenance, ...validation.provenance] };
    return { result, report: buildDiagnosticReport(result, input.reportOptions) };
  } catch (error) {
    reportConfigOperationError(input, "pipeline_declaration_load_failed", error);
    const issues = sourceLoadFailedIssues(error);
    const result: ConfigResult = {
      ok: false, config: {}, sources: [], issues, provenance: [], resolvedPaths: [],
      limits: { maxDepth: 0, maxKeyCount: 0, maxPathLength: 0, maxDiagnostics: Math.max(1, issues.length),
        maxSources: 1, maxProvenanceEvents: 1, maxResolvedPaths: 1, maxReportBytes: 4 * 1024 * 1024 }
    };
    return { result, report: buildDiagnosticReport(result, input.reportOptions) };
  }
}

export async function loadValidatedConfig<TOutput>(input: LoadConfigInput & {
  readonly outputValidator: ValidatorAdapter<TOutput>;
}): Promise<RunValidatedConfigPipelineResult<TOutput>> {
  return validateConfigOutput(await loadConfig({ ...input, validate: true }), input.outputValidator, input);
}

function toLoadedSourceAdapter(source: LoadedSource): ConfigLoader {
  return { descriptor: source.descriptor, load: () => ({ value: source.value,
    ...(source.issues === undefined ? {} : { issues: source.issues }),
    ...(source.locations === undefined ? {} : { locations: source.locations }) }) };
}

function cancelled(): PipelineDeclarationError {
  const issue: ConfigIssue = { category: "source-load", code: "operation_aborted", severity: "error",
    message: "Configuration operation was cancelled." };
  return new PipelineDeclarationError([issue]);
}
