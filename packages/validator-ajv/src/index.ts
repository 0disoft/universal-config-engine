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
import { cloneConfigValue, DEFAULT_RESOURCE_LIMITS, normalizeValidatorConstraint } from "@0disoft/universal-config-engine-core";

export interface CreateAjvValidatorInput {
  readonly id?: string;
  readonly schema: Schema;
  readonly ajv?: Ajv;
  readonly options?: Options;
  /** Retained issue budget, including truncation; defaults to 200, capped at 10,000. */
  readonly maxIssues?: number;
  /** Opt in only when schema limits/types are safe to disclose. */
  readonly includeConstraints?: boolean;
}

export function createAjvValidator(input: CreateAjvValidatorInput): ValidatorAdapter {
  const id = input.id ?? "ajv";
  // Ajv's inline first-error required check misses the empty property name;
  // its loop form preserves that supported path without collecting all errors.
  const ajv = input.ajv ?? new Ajv({ allErrors: false, loopRequired: 1, logger: false, ...(input.options ?? {}) });
  const maximum = typeof input.maxIssues === "number" && Number.isSafeInteger(input.maxIssues) && input.maxIssues > 0
    ? Math.min(input.maxIssues, 10_000) : DEFAULT_RESOURCE_LIMITS.maxDiagnostics;
  // Custom keywords can be registered on a supplied instance or through options.
  // Both may modify data; the default keyword-free read-only path needs no copy.
  const needsCopy = input.ajv !== undefined || Boolean(
    ajv.opts.coerceTypes || ajv.opts.useDefaults || ajv.opts.removeAdditional || ajv.opts.keywords
  );
  const validate = ajv.compile(input.schema);
  if ("$async" in validate && validate.$async === true) {
    throw new Error("Asynchronous Ajv schemas are not supported by this adapter.");
  }

  return {
    id,
    validate(validatorInput: ValidatorInput): ValidatorResult {
      const config = needsCopy ? cloneConfigValue(validatorInput.config) : validatorInput.config;
      // Let Ajv write root coercions through its existing parent-data context.
      // The schema itself stays unchanged, preserving local and registered refs.
      const root = { value: config };
      const ok = validate(config, {
        instancePath: "", parentData: root, parentDataProperty: "value",
        // Ajv's context type omits scalar roots although validate accepts them.
        rootData: config as Record<string, unknown>, dynamicAnchors: {}
      });
      const errors = validate.errors ?? [];

      if (ok) {
        return {
          ok: true,
          value: root.value,
          issues: []
        };
      }

      const truncated = errors.length > maximum;
      const retained = truncated ? maximum - 1 : errors.length;
      const issues: ValidatorIssue[] = [];
      for (let index = 0; index < retained; index += 1) {
        issues.push(toValidatorIssue(errors[index]!, root.value, input.includeConstraints === true));
      }
      if (truncated) issues.push({ code: "ajv_issues_truncated", severity: "error" });
      return { ok: false, issues };
    }
  };
}

function toValidatorIssue(error: ErrorObject, config: unknown, includeConstraints: boolean): ValidatorIssue {
  const constraint = includeConstraints ? normalizeValidatorConstraint({ kind: error.keyword,
    expected: error.params.type, limit: error.keyword === "multipleOf" ? error.params.multipleOf : error.params.limit }) : undefined;
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
    path: typeof property === "string" ? [...path, property] : path,
    ...(constraint === undefined ? {} : { constraint })
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
