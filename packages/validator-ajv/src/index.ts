import type {
  ConfigPath,
  ValidatorAdapter,
  ValidatorInput,
  ValidatorIssue,
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
        issues: errors.map((error) => toValidatorIssue(error, validatorInput.config))
      };
    }
  };
}

function toValidatorIssue(error: ErrorObject, config: unknown): ValidatorIssue {
  return {
    code: error.keyword,
    severity: "error",
    path: instancePathToConfigPath(error.instancePath, config)
  };
}

export function instancePathToConfigPath(instancePath: string, rootValue?: unknown): ConfigPath {
  if (instancePath.length === 0 || instancePath === "/") {
    return [];
  }

  const decodedSegments = instancePath
    .split("/")
    .slice(1)
    .map((segment) => decodePointerSegment(segment));
  const path: (string | number)[] = [];
  let current = rootValue;

  for (const segment of decodedSegments) {
    const numericSegment = Number(segment);
    const pathSegment =
      Array.isArray(current) && Number.isSafeInteger(numericSegment) && String(numericSegment) === segment
        ? numericSegment
        : segment;
    path.push(pathSegment);
    current = getChildValue(current, pathSegment);
  }

  return path;
}

function getChildValue(value: unknown, segment: string | number): unknown {
  if (value === null || typeof value !== "object") {
    return undefined;
  }
  return (value as Readonly<Record<string | number, unknown>>)[segment];
}

function decodePointerSegment(segment: string): string {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}
