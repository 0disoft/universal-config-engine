import type {
  ConfigIssue,
  ValidatorAdapter
} from "@0disoft/universal-config-engine-core";
import { combineConfigIssues, DEFAULT_RESOURCE_LIMITS, reportConfigOperationError,
  type ConfigOperationOptions } from "@0disoft/universal-config-engine-core";
import type {
  PipelineDeclaration,
  AjvJsonSchemaValidatorDeclaration,
  PipelineValidatorDeclaration
} from "./declaration-types.js";

export interface CreateDeclaredValidatorsResult {
  readonly validators: readonly ValidatorAdapter[];
  readonly issues: readonly ConfigIssue[];
}

export type DeclaredValidatorFactory = (declaration: AjvJsonSchemaValidatorDeclaration) => ValidatorAdapter;

export function createDeclaredValidators(declaration: PipelineDeclaration, factory?: DeclaredValidatorFactory,
  options: ConfigOperationOptions = {}): CreateDeclaredValidatorsResult {
  const validators: ValidatorAdapter[] = [];
  let issues: readonly ConfigIssue[] = [];
  const maxEvents = positiveLimit(declaration.limits?.maxProvenanceEvents, DEFAULT_RESOURCE_LIMITS.maxProvenanceEvents);
  const maxDiagnostics = positiveLimit(declaration.limits?.maxDiagnostics, DEFAULT_RESOURCE_LIMITS.maxDiagnostics);
  if ((declaration.validators?.length ?? 0) > maxEvents) return { validators, issues: [{
    category: "resource-limit", code: "max_provenance_events_exceeded", severity: "error",
    message: "Declared validators exceed the provenance budget."
  }] };
  function record(issue: ConfigIssue): boolean {
    const overflow = issues.length >= maxDiagnostics;
    issues = combineConfigIssues(issues, [issue], maxDiagnostics);
    return !overflow;
  }

  for (const validator of declaration.validators ?? []) {
    if (!isSupportedValidatorDeclaration(validator)) {
      if (!record({
        category: "validation",
        code: "unsupported_validator_declaration",
        severity: "error",
        sourceId: validator.id, validatorId: validator.id,
        message: `Validator ${validator.id} must use kind json-schema-ajv.`
      })) break;
      continue;
    }

    try {
      if (factory === undefined) {
        if (!record({ category: "validation", code: "validator_factory_missing", severity: "error",
          sourceId: validator.id, validatorId: validator.id,
          message: "Supply a validator factory to validate declared schemas." })) break;
        continue;
      }
      validators.push(
        factory({
          id: validator.id, kind: "json-schema-ajv",
          schema: validator.schema
        })
      );
    } catch (error) {
      reportConfigOperationError(options, "validator_compile_failed", error, validator.id);
      if (!record({
        category: "validation",
        code: "validator_compile_failed",
        severity: "error",
        sourceId: validator.id, validatorId: validator.id,
        message: `Validator ${validator.id} failed to compile. Exception details were omitted from diagnostics.`
      })) break;
    }
  }

  return {
    validators,
    issues
  };
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function isSupportedValidatorDeclaration(
  validator: PipelineValidatorDeclaration
): validator is AjvJsonSchemaValidatorDeclaration {
  return (
    validator.kind === "json-schema-ajv" &&
    (typeof validator.schema === "boolean" || (validator.schema !== null && typeof validator.schema === "object"))
  );
}
