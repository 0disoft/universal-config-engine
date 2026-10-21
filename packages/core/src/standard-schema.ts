import { isRecord } from "./adapter-guards.js";
import { normalizeResourceLimits } from "./limits.js";
import type { ConfigPath, ValidatorAdapter, ValidatorIssue, ValidatorResult } from "./types.js";

/** Structural Standard Schema v1 compatibility; no provider/runtime dependency. */
export interface StandardConfigSchema<TOutput = unknown> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => StandardConfigSchemaResult<TOutput> | Promise<StandardConfigSchemaResult<TOutput>>;
    readonly types?: { readonly input: unknown; readonly output: TOutput } | undefined;
  };
}

export interface StandardConfigSchemaIssue {
  readonly message: string;
  readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[] | undefined;
}

export type StandardConfigSchemaResult<TOutput> =
  | { readonly value: TOutput; readonly issues?: undefined }
  | { readonly issues: readonly StandardConfigSchemaIssue[] };

export type StandardConfigSchemaOutput<TSchema extends StandardConfigSchema> =
  TSchema extends StandardConfigSchema<infer TOutput> ? TOutput : never;

export interface CreateStandardSchemaValidatorInput<TOutput = unknown> {
  readonly schema: StandardConfigSchema<TOutput>;
  readonly id?: string;
  /** Defaults to maxDiagnostics (200), with a hard cap of 10,000. */
  readonly maxIssues?: number;
}

export function createStandardSchemaValidator<TOutput>(
  input: CreateStandardSchemaValidatorInput<TOutput>
): ValidatorAdapter<TOutput> {
  const properties = input.schema?.["~standard"];
  if (properties?.version !== 1 || typeof properties.vendor !== "string" || typeof properties.validate !== "function") {
    throw new TypeError("Expected a Standard Schema v1 validator.");
  }
  const validate = properties.validate.bind(properties);
  const maximum = Math.min(10_000, normalizeResourceLimits(
    input.maxIssues === undefined ? undefined : { maxDiagnostics: input.maxIssues }).maxDiagnostics);
  return {
    id: input.id ?? "standard-schema",
    async validate(input) {
      // Rejections deliberately reach core's sanitized validator_threw boundary.
      return normalizeSchemaResult<TOutput>(await validate(input.config), maximum);
    }
  };
}

function normalizeSchemaResult<TOutput>(raw: unknown, maximum: number): ValidatorResult<TOutput> {
  if (!isRecord(raw)) return invalidResult();
  if (raw.issues === undefined) {
    return Object.hasOwn(raw, "value") ? { ok: true, value: raw.value as TOutput, issues: [] } : invalidResult();
  }
  if (!Array.isArray(raw.issues) || raw.issues.length === 0 || Object.hasOwn(raw, "value")) return invalidResult();
  const issues: ValidatorIssue[] = [];
  const truncated = raw.issues.length > maximum;
  const retained = truncated ? maximum - 1 : raw.issues.length;
  for (let index = 0; index < retained; index += 1) {
    const issue: unknown = raw.issues[index];
    if (!isRecord(issue) || typeof issue.message !== "string") { issues.push(invalidIssue()); continue; }
    const path = normalizePath(issue.path);
    issues.push(path === false ? { code: "standard_schema_invalid_path", severity: "error" }
      : { code: "standard_schema_issue", severity: "error", ...(path === undefined ? {} : { path }) });
  }
  if (truncated) issues.push({ code: "standard_schema_issues_truncated", severity: "error" });
  return { ok: false, issues };
}

function normalizePath(raw: unknown): ConfigPath | undefined | false {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length > 256) return false;
  const path: (string | number)[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const segment: unknown = raw[index];
    const key = isRecord(segment) && Object.hasOwn(segment, "key") ? segment.key : segment;
    if (typeof key !== "string" && !(typeof key === "number" && Number.isSafeInteger(key) && key >= 0)) return false;
    path.push(key);
  }
  return path;
}

function invalidIssue(): ValidatorIssue {
  return { code: "standard_schema_invalid_result", severity: "error" };
}

function invalidResult(): ValidatorResult<never> { return { ok: false, issues: [invalidIssue()] }; }
