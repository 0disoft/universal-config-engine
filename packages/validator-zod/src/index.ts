import type {
  ConfigIssue,
  ConfigPath,
  ValidatorAdapter,
  ValidatorInput,
  ValidatorResult
} from "@0disoft/universal-config-engine-core";
import type { z } from "zod";

export interface CreateZodValidatorInput<TSchema extends z.ZodType> {
  readonly id?: string;
  readonly schema: TSchema;
}

export type ZodValidatorOutput<TSchema extends z.ZodType> = z.output<TSchema>;

export function createZodValidator<TSchema extends z.ZodType>(
  input: CreateZodValidatorInput<TSchema>
): ValidatorAdapter<ZodValidatorOutput<TSchema>> {
  return {
    id: input.id ?? "zod",
    validate(validatorInput: ValidatorInput): ValidatorResult<ZodValidatorOutput<TSchema>> {
      const result = input.schema.safeParse(validatorInput.config);

      if (result.success) {
        return {
          ok: true,
          value: result.data,
          issues: []
        };
      }

      return {
        ok: false,
        issues: result.error.issues.map((issue): ConfigIssue => ({
          category: "validation",
          code: issue.code,
          severity: "error",
          path: toConfigPath(issue.path),
          sourceId: input.id ?? "zod",
          message: issue.message
        }))
      };
    }
  };
}

function toConfigPath(path: readonly PropertyKey[]): ConfigPath {
  return path.map((segment) => {
    if (typeof segment === "number") {
      return segment;
    }

    return String(segment);
  });
}
