import { resolveConfig } from "./merge.js";
import { combineConfigIssues, applyPipelineValidators, runConfigPipeline, type RunConfigPipelineInput, type RunConfigPipelineResult } from "./pipeline.js";
import { buildDiagnosticReport } from "./redaction.js";
import { normalizeResourceLimits } from "./limits.js";
import { isRecord } from "./adapter-guards.js";
import type { ConfigIssue, ValidatorAdapter } from "./types.js";

export interface RunValidatedConfigPipelineInput<TOutput, TContext = undefined> extends RunConfigPipelineInput<TContext> {
  readonly outputValidator: ValidatorAdapter<TOutput>;
}

export type RunValidatedConfigPipelineResult<TOutput> = RunConfigPipelineResult & (
  | { readonly ok: true; readonly value: TOutput }
  | { readonly ok: false; readonly value?: never }
);

/** Return schema output separately; resolved config and its provenance stay unchanged. */
export async function runValidatedConfigPipeline<TOutput, TContext = undefined>(
  input: RunValidatedConfigPipelineInput<TOutput, TContext>
): Promise<RunValidatedConfigPipelineResult<TOutput>> {
  const maximumValidators = normalizeResourceLimits(input.limits).maxProvenanceEvents;
  if ((input.validators?.length ?? 0) >= maximumValidators) {
    return setupFailure(input, { category: "resource-limit", code: "max_provenance_events_exceeded", severity: "error",
      message: "Pipeline validators and the output validator exceed the provenance budget." });
  }
  if (input.validators?.some(validator => validator.id === input.outputValidator.id)) {
    return setupFailure(input, { category: "usage", code: "typed_validator_id_conflict", severity: "error",
      message: "The output validator must have a distinct id from pipeline validators." });
  }
  const pipeline = await runConfigPipeline(input);
  return validateConfigOutput(pipeline, input.outputValidator, input);
}

/** Validate typed output from an existing pipeline without reloading its sources. */
export async function validateConfigOutput<TOutput>(
  pipeline: RunConfigPipelineResult,
  validator: ValidatorAdapter<TOutput>,
  options: Pick<RunConfigPipelineInput, "signal" | "onError" | "reportOptions"> = {}
): Promise<RunValidatedConfigPipelineResult<TOutput>> {
  if (!pipeline.result.ok || pipeline.report.status !== "ok") return { ...pipeline, ok: false };
  if (pipeline.result.provenance.some(event => event.action === "validated" && event.sourceId === validator.id)) {
    const issues = combineConfigIssues(pipeline.result.issues, [{ category: "usage", code: "typed_validator_id_conflict",
      severity: "error", message: "The output validator must have a distinct id from pipeline validators." }], pipeline.result.limits.maxDiagnostics);
    const result = { ...pipeline.result, ok: false, issues };
    return { ok: false, result, report: buildDiagnosticReport(result, options.reportOptions) };
  }
  let captured = false;
  let value!: TOutput;
  const outputValidator: ValidatorAdapter = {
    id: validator.id,
    async validate(validatorInput) {
      const validated = await validator.validate(validatorInput);
      if (isRecord(validated) && validated.ok === true && Array.isArray(validated.issues)) {
        if (!Object.hasOwn(validated, "value")) {
          return { ok: false, issues: [{ code: "typed_output_missing", severity: "error" }] };
        }
        value = validated.value as TOutput;
        captured = true;
      }
      return validated;
    }
  };
  // Running after the ordinary pipeline avoids invoking output transforms on
  // invalid inputs. The existing stage owns frozen inputs and aggregate budgets.
  const result = await applyPipelineValidators(pipeline.result, [outputValidator], options);
  const report = buildDiagnosticReport(result, options.reportOptions);
  return result.ok && report.status === "ok" && captured
    ? { ok: true, value, result, report }
    : { ok: false, result, report };
}

function setupFailure(input: Pick<RunConfigPipelineInput, "limits" | "reportOptions">,
  issue: ConfigIssue): RunValidatedConfigPipelineResult<never> {
  const result = { ...resolveConfig({ sources: [], ...(input.limits === undefined ? {} : { limits: input.limits }) }),
    ok: false, issues: [issue] };
  return { ok: false, result, report: buildDiagnosticReport(result, input.reportOptions) };
}
