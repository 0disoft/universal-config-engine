import type {
  ConfigPath,
  ValidatorAdapter,
  ValidatorInput,
  ValidatorIssue,
  ValidatorResult
} from "@0disoft/universal-config-engine-core";
import type { z } from "zod";
import { DEFAULT_RESOURCE_LIMITS, normalizeValidatorConstraint } from "@0disoft/universal-config-engine-core";

export interface CreateZodValidatorInput<TSchema extends z.ZodType> {
  readonly id?: string;
  readonly schema: TSchema;
  /** Retained issue budget, including truncation; defaults to 200, capped at 10,000. */
  readonly maxIssues?: number;
  /** Opt in only when schema limits/types are safe to disclose. */
  readonly includeConstraints?: boolean;
}

export type ZodValidatorOutput<TSchema extends z.ZodType> = z.output<TSchema>;

export function createZodValidator<TSchema extends z.ZodType>(
  input: CreateZodValidatorInput<TSchema>
): ValidatorAdapter<ZodValidatorOutput<TSchema>> {
  const maximum = typeof input.maxIssues === "number" && Number.isSafeInteger(input.maxIssues) && input.maxIssues > 0
    ? Math.min(input.maxIssues, 10_000) : DEFAULT_RESOURCE_LIMITS.maxDiagnostics;
  return {
    id: input.id ?? "zod",
    async validate(validatorInput: ValidatorInput): Promise<ValidatorResult<ZodValidatorOutput<TSchema>>> {
      const result = await input.schema.safeParseAsync(validatorInput.config);

      if (result.success) {
        return {
          ok: true,
          value: result.data,
          issues: []
        };
      }

      const errors = result.error.issues;
      const truncated = errors.length > maximum;
      const retained = truncated ? maximum - 1 : errors.length;
      const issues: ValidatorIssue[] = [];
      for (let index = 0; index < retained; index++) {
        const issue = errors[index]!;
        const constraint = input.includeConstraints === true ? publicConstraint(issue) : undefined;
        issues.push({
          code: issue.code,
          severity: "error",
          path: toConfigPath(issue.path),
          ...(constraint === undefined ? {} : { constraint })
        });
      }
      if (truncated) issues.push({ code: "zod_issues_truncated", severity: "error" });
      return { ok: false, issues };
    }
  };
}

function publicConstraint(issue: z.core.$ZodIssue) {
  if (issue.code === "invalid_type") return normalizeValidatorConstraint({ kind: "type",
    expected: issue.expected === "int" ? "integer" : issue.expected });
  if (issue.code === "not_multiple_of") return normalizeValidatorConstraint({ kind: "multipleOf", limit: issue.divisor });
  if (issue.code !== "too_small" && issue.code !== "too_big") return undefined;
  const lower = issue.code === "too_small";
  const limit = lower ? issue.minimum : issue.maximum;
  if (issue.origin === "number") {
    const inclusive = lower ? "minimum" : "maximum";
    const exclusive = lower ? "exclusiveMinimum" : "exclusiveMaximum";
    return normalizeValidatorConstraint({ kind: issue.inclusive === false ? exclusive : inclusive, limit });
  }
  if (issue.origin === "string") return normalizeValidatorConstraint({ kind: lower ? "minLength" : "maxLength", limit });
  if (issue.origin === "array") return normalizeValidatorConstraint({ kind: lower ? "minItems" : "maxItems", limit });
  return undefined;
}

function toConfigPath(path: readonly PropertyKey[]): ConfigPath {
  return path.map((segment) => {
    if (typeof segment === "number") {
      return segment;
    }

    return String(segment);
  });
}
