import { isRecord } from "./adapter-guards.js";

export type ValidatorConstraint =
  | { readonly kind: "type"; readonly expected: "string" | "number" | "integer" | "boolean" | "object" | "array" | "null" }
  | { readonly kind: "minimum" | "maximum" | "exclusiveMinimum" | "exclusiveMaximum" | "multipleOf"
      | "minLength" | "maxLength" | "minItems" | "maxItems" | "minProperties" | "maxProperties"; readonly limit: number }
  | { readonly kind: "required" | "additionalProperties" };

const TYPES = new Set(["string", "number", "integer", "boolean", "object", "array", "null"]);
const NUMERIC = new Set(["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
  "minLength", "maxLength", "minItems", "maxItems", "minProperties", "maxProperties"]);

/** Copy only public machine constraints; never retain provider prose or values. */
export function normalizeValidatorConstraint(value: unknown): ValidatorConstraint | undefined {
  if (!isRecord(value)) return undefined;
  const kind = value.kind;
  if (kind === "type" && typeof value.expected === "string" && TYPES.has(value.expected)) {
    return { kind, expected: value.expected } as ValidatorConstraint;
  }
  if (typeof kind === "string" && NUMERIC.has(kind) && typeof value.limit === "number" && Number.isFinite(value.limit)) {
    return { kind, limit: value.limit } as ValidatorConstraint;
  }
  return kind === "required" || kind === "additionalProperties" ? { kind } : undefined;
}
