import { DEFAULT_RESOURCE_LIMITS } from "./merge.js";
import { cloneConfigValue } from "./path.js";
import type {
  ConfigIssue,
  ConfigPath,
  ConfigValue,
  ProvenanceEvent,
  ResourceLimitPolicy,
  ValidatorAdapter,
  ValidatorIssue,
  ValidatorResult
} from "./types.js";

const VALIDATOR_ISSUE_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;

export interface RunValidatorsInput {
  readonly config: ConfigValue;
  readonly provenance: readonly ProvenanceEvent[];
  readonly validators: readonly ValidatorAdapter[];
  readonly limits?: Partial<ResourceLimitPolicy>;
}

export interface RunValidatorsResult {
  readonly issues: readonly ConfigIssue[];
  readonly provenance: readonly ProvenanceEvent[];
}

export async function runValidators(input: RunValidatorsInput): Promise<RunValidatorsResult> {
  const issues: ConfigIssue[] = [];
  const provenance: ProvenanceEvent[] = [];
  const maxDiagnostics = Math.max(1, input.limits?.maxDiagnostics ?? DEFAULT_RESOURCE_LIMITS.maxDiagnostics);
  const validatorConfig = freezeConfigValue(cloneConfigValue(input.config));

  for (const validator of input.validators) {
    if (isDiagnosticsLimitReached(issues, maxDiagnostics)) {
      break;
    }

    try {
      const result = await validator.validate({
        config: validatorConfig,
        provenance: input.provenance
      });
      if (!isValidatorResult(result)) {
        pushBoundedIssues(issues, [invalidValidatorResultIssue(validator.id)], maxDiagnostics);
        provenance.push({
          path: [],
          action: "validated",
          sourceId: validator.id,
          message: `Validator ${validator.id} returned an invalid result.`
        });
        continue;
      }

      const validatorIssues = normalizeValidatorIssues(
        validator.id,
        result.issues,
        Math.max(0, maxDiagnostics - issues.length)
      );
      pushBoundedIssues(issues, validatorIssues, maxDiagnostics);
      if (!result.ok && !validatorIssues.some((issue) => issue.severity === "error")) {
        pushBoundedIssues(issues, [validatorFailedWithoutIssuesIssue(validator.id)], maxDiagnostics);
      }
      provenance.push({
        path: [],
        action: "validated",
        sourceId: validator.id,
        message: `Validator ${validator.id} completed with status ${validatorStatus(result, validatorIssues)}.`
      });
    } catch {
      pushBoundedIssues(
        issues,
        [
          {
            category: "validation",
            code: "validator_threw",
            severity: "error",
            sourceId: validator.id,
            message: `Validator ${validator.id} threw an exception. Exception details were omitted from diagnostics.`
          }
        ],
        maxDiagnostics
      );
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

function freezeConfigValue(value: ConfigValue): ConfigValue {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      freezeConfigValue(item);
    }
    return Object.freeze(value);
  }

  for (const child of Object.values(value)) {
    freezeConfigValue(child);
  }
  return Object.freeze(value);
}

function normalizeValidatorIssues(
  validatorId: string,
  issues: readonly unknown[],
  maxDiagnostics: number
): readonly ConfigIssue[] {
  const normalizedIssues: ConfigIssue[] = [];

  for (const [index, issue] of issues.entries()) {
    if (normalizedIssues.length >= maxDiagnostics) {
      replaceLastIssueWithDiagnosticsExceededMarker(normalizedIssues, maxDiagnostics);
      break;
    }

    if (!isValidatorIssue(issue)) {
      normalizedIssues.push(invalidValidatorIssue(validatorId, index));
      if (index < issues.length - 1 && normalizedIssues.length >= maxDiagnostics) {
        replaceLastIssueWithDiagnosticsExceededMarker(normalizedIssues, maxDiagnostics);
        break;
      }
      continue;
    }

    normalizedIssues.push({
      category: "validation",
      code: issue.code,
      severity: issue.severity,
      message: `Validator ${validatorId} reported validation issue ${issue.code}.`,
      ...(issue.path === undefined ? {} : { path: issue.path }),
      sourceId: validatorId
    });
    if (index < issues.length - 1 && normalizedIssues.length >= maxDiagnostics) {
      replaceLastIssueWithDiagnosticsExceededMarker(normalizedIssues, maxDiagnostics);
      break;
    }
  }

  return normalizedIssues;
}

function pushBoundedIssues(
  destination: ConfigIssue[],
  nextIssues: readonly ConfigIssue[],
  maxDiagnostics: number
): void {
  for (const [index, issue] of nextIssues.entries()) {
    if (destination.length >= maxDiagnostics) {
      replaceLastIssueWithDiagnosticsExceededMarker(destination, maxDiagnostics);
      return;
    }
    destination.push(issue);
    if (index < nextIssues.length - 1 && destination.length >= maxDiagnostics) {
      replaceLastIssueWithDiagnosticsExceededMarker(destination, maxDiagnostics);
      return;
    }
  }
}

function isDiagnosticsLimitReached(issues: readonly ConfigIssue[], maxDiagnostics: number): boolean {
  return (
    issues.length >= maxDiagnostics &&
    issues.some((issue) => issue.category === "resource-limit" && issue.code === "max_diagnostics_exceeded")
  );
}

function replaceLastIssueWithDiagnosticsExceededMarker(issues: ConfigIssue[], maxDiagnostics: number): void {
  if (issues.some((issue) => issue.category === "resource-limit" && issue.code === "max_diagnostics_exceeded")) {
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

function isValidatorResult(value: unknown): value is ValidatorResult {
  return (
    isRecord(value) &&
    typeof value.ok === "boolean" &&
    Array.isArray(value.issues)
  );
}

function isValidatorIssue(value: unknown): value is ValidatorIssue {
  return (
    isRecord(value) &&
    (value.category === undefined || value.category === "validation") &&
    typeof value.code === "string" &&
    VALIDATOR_ISSUE_CODE_PATTERN.test(value.code) &&
    (value.severity === "error" || value.severity === "warning") &&
    (value.path === undefined || isConfigPath(value.path)) &&
    (value.message === undefined || typeof value.message === "string") &&
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
