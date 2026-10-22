import { runAbortable, operationAbortedIssue, reportConfigOperationError, type ConfigOperationOptions } from "./operation.js";
import { appendBoundedIssues, isDiagnosticsLimitReached, markDiagnosticsOverflow } from "./diagnostics.js";
import { isConfigPath, isIssueCode, isIssueDetails, isRecord } from "./adapter-guards.js";
import { normalizeResourceLimits } from "./limits.js";
import { cloneConfigValue } from "./path.js";
import type {
  ConfigIssue,
  ConfigValue,
  ProvenanceEvent,
  ResourceLimitPolicy,
  ValidatorAdapter,
  ValidatorIssue,
  ValidatorResult
} from "./types.js";

export interface RunValidatorsInput extends ConfigOperationOptions {
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
  const limits = normalizeResourceLimits(input.limits);
  const maxDiagnostics = limits.maxDiagnostics;
  if (input.signal?.aborted) return { issues: [operationAbortedIssue("validation")], provenance };
  const remainingProvenanceEvents = limits.maxProvenanceEvents - input.provenance.length;
  if (remainingProvenanceEvents < 0 || (remainingProvenanceEvents === 0 && input.validators.length > 0)) {
    return {
      issues: [provenanceLimitIssue(limits.maxProvenanceEvents)],
      provenance
    };
  }
  const validatorConfig = freezeConfigValue(cloneConfigValue(input.config));
  const validatorProvenance = freezeProvenance(input.provenance);

  for (const validator of input.validators) {
    if (provenance.length >= remainingProvenanceEvents) {
      appendBoundedIssues(issues, [provenanceLimitIssue(limits.maxProvenanceEvents)], maxDiagnostics);
      break;
    }
    if (isDiagnosticsLimitReached(issues, maxDiagnostics)) {
      break;
    }

    try {
      const step = await runAbortable(() => validator.validate({
        config: validatorConfig, provenance: validatorProvenance,
        ...(input.signal === undefined ? {} : { signal: input.signal })
      }), input.signal);
      if (step.aborted) {
        appendBoundedIssues(issues, [operationAbortedIssue("validation", validator.id)], maxDiagnostics);
        break;
      }
      const result = step.value;
      if (!isValidatorResult(result)) {
        appendBoundedIssues(issues, [invalidValidatorResultIssue(validator.id)], maxDiagnostics);
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
        Math.max(0, maxDiagnostics - issues.length),
        limits
      );
      appendBoundedIssues(issues, validatorIssues, maxDiagnostics);
      if (!result.ok && !validatorIssues.some((issue) => issue.severity === "error")) {
        appendBoundedIssues(issues, [validatorFailedWithoutIssuesIssue(validator.id)], maxDiagnostics);
      }
      provenance.push({
        path: [],
        action: "validated",
        sourceId: validator.id,
        message: `Validator ${validator.id} completed with status ${validatorStatus(result, validatorIssues)}.`
      });
    } catch (error) {
      reportConfigOperationError(input, "validator_threw", error, validator.id);
      appendBoundedIssues(
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

function provenanceLimitIssue(maximum: number): ConfigIssue {
  return {
    category: "resource-limit",
    code: "max_provenance_events_exceeded",
    severity: "error",
    message: `Retained entries exceeded the maximum of ${maximum}.`
  };
}

function freezeProvenance(input: readonly ProvenanceEvent[]): readonly ProvenanceEvent[] {
  return Object.freeze(
    input.map((event) =>
      Object.freeze({
        path: Object.freeze([...event.path]),
        action: event.action,
        sourceId: event.sourceId,
        ...(event.previousSourceId === undefined ? {} : { previousSourceId: event.previousSourceId }),
        message: event.message
      })
    )
  );
}

function freezeConfigValue(value: ConfigValue): ConfigValue {
  const stack: Iterator<ConfigValue>[] = [[value].values()];
  while (stack.length > 0) {
    const next = stack[stack.length - 1]!.next();
    if (next.done) {
      stack.pop();
      continue;
    }
    const child = next.value;
    if (child === null || typeof child !== "object") continue;
    Object.freeze(child);
    stack.push(Array.isArray(child) ? child.values() : Object.values(child).values());
  }
  return value;
}

function normalizeValidatorIssues(
  validatorId: string,
  issues: readonly unknown[],
  maxDiagnostics: number,
  limits: ResourceLimitPolicy
): readonly ConfigIssue[] {
  const normalizedIssues: ConfigIssue[] = [];

  for (const [index, issue] of issues.entries()) {
    if (normalizedIssues.length >= maxDiagnostics) {
      markDiagnosticsOverflow(normalizedIssues, maxDiagnostics);
      break;
    }

    if (!isValidatorIssue(issue, limits)) {
      normalizedIssues.push(invalidValidatorIssue(validatorId, index));
      if (index < issues.length - 1 && normalizedIssues.length >= maxDiagnostics) {
        markDiagnosticsOverflow(normalizedIssues, maxDiagnostics);
        break;
      }
      continue;
    }

    normalizedIssues.push({
      category: "validation",
      code: issue.code,
      severity: issue.severity,
      message: `Validator ${validatorId} reported validation issue ${issue.code}.`,
      ...(issue.path === undefined ? {} : { path: [...issue.path] }),
      sourceId: validatorId
    });
    if (index < issues.length - 1 && normalizedIssues.length >= maxDiagnostics) {
      markDiagnosticsOverflow(normalizedIssues, maxDiagnostics);
      break;
    }
  }

  return normalizedIssues;
}

function isValidatorResult(value: unknown): value is ValidatorResult {
  return (
    isRecord(value) &&
    typeof value.ok === "boolean" &&
    Array.isArray(value.issues)
  );
}

function isValidatorIssue(value: unknown, limits: ResourceLimitPolicy): value is ValidatorIssue {
  return (
    isRecord(value) &&
    (value.category === undefined || value.category === "validation") &&
    isIssueCode(value.code) &&
    (value.severity === "error" || value.severity === "warning") &&
    (value.path === undefined || isConfigPath(value.path, limits)) &&
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
