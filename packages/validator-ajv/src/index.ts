import type {
  ConfigIssue,
  ConfigPath,
  ValidatorAdapter,
  ValidatorInput,
  ValidatorResult
} from "@0disoft/universal-config-engine-core";
import {
  Ajv,
  type ErrorObject,
  type Options,
  type Schema
} from "ajv/dist/ajv.js";

export interface CreateAjvValidatorInput {
  readonly id?: string;
  readonly schema: Schema;
  readonly ajv?: Ajv;
  readonly options?: Options;
}

export function createAjvValidator(input: CreateAjvValidatorInput): ValidatorAdapter {
  const id = input.id ?? "ajv";
  const ajv = input.ajv ?? new Ajv({ allErrors: true, ...(input.options ?? {}) });
  const validate = ajv.compile(input.schema);

  return {
    id,
    validate(validatorInput: ValidatorInput): ValidatorResult {
      const ok = validate(validatorInput.config);
      const errors = [...(validate.errors ?? [])];

      if (ok) {
        return {
          ok: true,
          value: validatorInput.config,
          issues: []
        };
      }

      return {
        ok: false,
        issues: errors.map((error) => toConfigIssue(id, error))
      };
    }
  };
}

function toConfigIssue(sourceId: string, error: ErrorObject): ConfigIssue {
  return {
    category: "validation",
    code: error.keyword,
    severity: "error",
    path: instancePathToConfigPath(error.instancePath),
    sourceId,
    message: error.message ?? `JSON Schema validation failed for ${error.keyword}.`
  };
}

export function instancePathToConfigPath(instancePath: string): ConfigPath {
  if (instancePath.length === 0) {
    return [];
  }

  return instancePath
    .split("/")
    .slice(1)
    .map((segment) => decodePointerSegment(segment))
    .map((segment) => {
      const numericSegment = Number(segment);
      return Number.isInteger(numericSegment) && String(numericSegment) === segment ? numericSegment : segment;
    });
}

function decodePointerSegment(segment: string): string {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}
