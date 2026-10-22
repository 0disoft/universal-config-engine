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
import { cloneConfigValue, DEFAULT_RESOURCE_LIMITS } from "@0disoft/universal-config-engine-core";

export interface CreateAjvValidatorInput {
  readonly id?: string;
  readonly schema: Schema;
  readonly ajv?: Ajv;
  readonly options?: Options;
  /** Retained issue budget, including truncation; defaults to 200, capped at 10,000. */
  readonly maxIssues?: number;
}

export function createAjvValidator(input: CreateAjvValidatorInput): ValidatorAdapter {
  const id = input.id ?? "ajv";
  // Ajv's inline first-error required check misses the empty property name;
  // its loop form preserves that supported path without collecting all errors.
  const ajv = input.ajv ?? new Ajv({ allErrors: false, loopRequired: 1, logger: false, ...(input.options ?? {}) });
  const maximum = typeof input.maxIssues === "number" && Number.isSafeInteger(input.maxIssues) && input.maxIssues > 0
    ? Math.min(input.maxIssues, 10_000) : DEFAULT_RESOURCE_LIMITS.maxDiagnostics;
  // Supplied instances can also have modifying custom keywords. Give those
  // validators an owned mutable value, without copying the default read-only path.
  const needsCopy = input.ajv !== undefined || Boolean(ajv.opts.coerceTypes || ajv.opts.useDefaults || ajv.opts.removeAdditional);
  const validate = ajv.compile(input.schema);
  if ("$async" in validate && validate.$async === true) {
    throw new Error("Asynchronous Ajv schemas are not supported by this adapter.");
  }

  return {
    id,
    validate(validatorInput: ValidatorInput): ValidatorResult {
      const config = needsCopy ? cloneConfigValue(validatorInput.config) : validatorInput.config;
      const ok = validate(config);
      const errors = validate.errors ?? [];

      if (ok) {
        return {
          ok: true,
          value: config,
          issues: []
        };
      }

      const truncated = errors.length > maximum;
      const retained = truncated ? maximum - 1 : errors.length;
      const issues: ValidatorIssue[] = [];
      for (let index = 0; index < retained; index += 1) {
        issues.push(toValidatorIssue(errors[index]!, config));
      }
      if (truncated) issues.push({ code: "ajv_issues_truncated", severity: "error" });
      return { ok: false, issues };
    }
  };
}

function toValidatorIssue(error: ErrorObject, config: unknown): ValidatorIssue {
  const path = instancePathToConfigPath(error.instancePath, config);
  const property = error.keyword === "required"
    ? error.params.missingProperty
    : error.keyword === "additionalProperties"
      ? error.params.additionalProperty
      : undefined;
  return {
    code: /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/.test(error.keyword)
      ? error.keyword
      : "ajv_custom_keyword",
    severity: "error",
    path: typeof property === "string" ? [...path, property] : path
  };
}

export function instancePathToConfigPath(instancePath: string, rootValue?: unknown): ConfigPath {
  if (instancePath.length === 0) {
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
