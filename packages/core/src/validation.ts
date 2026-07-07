import type {
  ConfigIssue,
  ConfigPath,
  ConfigValue,
  ProvenanceEvent,
  ValidatorAdapter,
  ValidatorResult
} from "./types.js";

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
      if (!isValidatorResult(result)) {
        issues.push(invalidValidatorResultIssue(validator.id));
        provenance.push({
          path: [],
          action: "validated",
          sourceId: validator.id,
          message: `Validator ${validator.id} returned an invalid result.`
        });
        continue;
      }

      const validatorIssues = normalizeValidatorIssues(validator.id, result.issues);
      issues.push(...validatorIssues);
      if (!result.ok && !validatorIssues.some((issue) => issue.severity === "error")) {
        issues.push(validatorFailedWithoutIssuesIssue(validator.id));
      }
      provenance.push({
        path: [],
        action: "validated",
        sourceId: validator.id,
        message: `Validator ${validator.id} completed with status ${validatorStatus(result, validatorIssues)}.`
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

function normalizeValidatorIssues(validatorId: string, issues: readonly unknown[]): readonly ConfigIssue[] {
  return issues.map((issue, index) => {
    if (!isValidatorIssue(issue)) {
      return invalidValidatorIssue(validatorId, index);
    }

    return {
      category: "validation",
      code: issue.code,
      severity: issue.severity,
      message: issue.message,
      ...(issue.path === undefined ? {} : { path: issue.path }),
      sourceId: issue.sourceId ?? validatorId,
      ...(issue.details === undefined ? {} : { details: issue.details })
    };
  });
}

function isValidatorResult(value: unknown): value is ValidatorResult {
  return (
    isRecord(value) &&
    typeof value.ok === "boolean" &&
    Array.isArray(value.issues)
  );
}

function isValidatorIssue(value: unknown): value is ConfigIssue {
  return (
    isRecord(value) &&
    value.category === "validation" &&
    typeof value.code === "string" &&
    value.code.length > 0 &&
    (value.severity === "error" || value.severity === "warning") &&
    typeof value.message === "string" &&
    value.message.length > 0 &&
    (value.path === undefined || isConfigPath(value.path)) &&
    (value.sourceId === undefined || typeof value.sourceId === "string") &&
    (value.details === undefined || isIssueDetails(value.details))
  );
}

function invalidValidatorResultIssue(validatorId: string): ConfigIssue {
  return {
    category: "validation",
    code: "validator_result_invalid",
    severity: "error",
    sourceId: validatorId,
    message: `Validator ${validatorId} returned an invalid result.`
  };
}

function invalidValidatorIssue(validatorId: string, index: number): ConfigIssue {
  return {
    category: "validation",
    code: "validator_issue_invalid",
    severity: "error",
    sourceId: validatorId,
    message: `Validator ${validatorId} returned invalid issue at index ${index}.`
  };
}

function validatorFailedWithoutIssuesIssue(validatorId: string): ConfigIssue {
  return {
    category: "validation",
    code: "validator_failed_without_issues",
    severity: "error",
    sourceId: validatorId,
    message: `Validator ${validatorId} returned ok false without any error issues.`
  };
}

function validatorStatus(result: ValidatorResult, issues: readonly ConfigIssue[]): "ok" | "error" {
  return result.ok && !issues.some((issue) => issue.severity === "error") ? "ok" : "error";
}

function isConfigPath(value: unknown): value is ConfigPath {
  return (
    Array.isArray(value) &&
    value.every((segment) => typeof segment === "string" || typeof segment === "number")
  );
}

function isIssueDetails(value: unknown): value is Readonly<Record<string, string | number | boolean | null>> {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (detailValue) =>
        typeof detailValue === "string" ||
        typeof detailValue === "number" ||
        typeof detailValue === "boolean" ||
        detailValue === null
    )
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
