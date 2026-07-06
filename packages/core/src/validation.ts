import type { ConfigIssue, ConfigValue, ProvenanceEvent, ValidatorAdapter } from "./types.js";

export interface RunValidatorsInput {
  readonly config: ConfigValue;
  readonly provenance: readonly ProvenanceEvent[];
  readonly validators: readonly ValidatorAdapter[];
}

export interface RunValidatorsResult {
  readonly issues: readonly ConfigIssue[];
  readonly provenance: readonly ProvenanceEvent[];
}

export async function runValidators(input: RunValidatorsInput): Promise<RunValidatorsResult> {
  const issues: ConfigIssue[] = [];
  const provenance: ProvenanceEvent[] = [];

  for (const validator of input.validators) {
    try {
      const result = await validator.validate({
        config: input.config,
        provenance: input.provenance
      });
      issues.push(...result.issues);
      provenance.push({
        path: [],
        action: "validated",
        sourceId: validator.id,
        message: `Validator ${validator.id} completed with status ${result.ok ? "ok" : "error"}.`
      });
    } catch (error) {
      issues.push({
        category: "validation",
        code: "validator_threw",
        severity: "error",
        sourceId: validator.id,
        message: error instanceof Error ? error.message : "Validator failed with an unknown error."
      });
      provenance.push({
        path: [],
        action: "validated",
        sourceId: validator.id,
        message: `Validator ${validator.id} failed.`
      });
    }
  }

  return { issues, provenance };
}
