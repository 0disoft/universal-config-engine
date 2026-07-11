import type {
  ConfigIssue,
  ValidatorAdapter
} from "@0disoft/universal-config-engine-core";
import { createAjvValidator } from "@0disoft/universal-config-engine-validator-ajv";
import type {
  PipelineDeclaration,
  AjvJsonSchemaValidatorDeclaration,
  PipelineValidatorDeclaration
} from "./types.js";

export interface CreateDeclaredValidatorsResult {
  readonly validators: readonly ValidatorAdapter[];
  readonly issues: readonly ConfigIssue[];
}

export function createDeclaredValidators(declaration: PipelineDeclaration): CreateDeclaredValidatorsResult {
  const validators: ValidatorAdapter[] = [];
  const issues: ConfigIssue[] = [];

  for (const validator of declaration.validators ?? []) {
    if (!isSupportedValidatorDeclaration(validator)) {
      issues.push({
        category: "validation",
        code: "unsupported_validator_declaration",
        severity: "error",
        sourceId: validator.id,
        message: `Validator ${validator.id} must use kind json-schema-ajv.`
      });
      continue;
    }

    try {
      validators.push(
        createAjvValidator({
          id: validator.id,
          schema: validator.schema
        })
      );
    } catch {
      issues.push({
        category: "validation",
        code: "validator_compile_failed",
        severity: "error",
        sourceId: validator.id,
        message: `Validator ${validator.id} failed to compile. Exception details were omitted from diagnostics.`
      });
    }
  }

  return {
    validators,
    issues
  };
}

function isSupportedValidatorDeclaration(
  validator: PipelineValidatorDeclaration
): validator is AjvJsonSchemaValidatorDeclaration {
  return (
    validator.kind === "json-schema-ajv" &&
    (typeof validator.schema === "boolean" || (validator.schema !== null && typeof validator.schema === "object"))
  );
}
