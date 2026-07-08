import { getConfigValueAtPath, setConfigValueAtPath } from "./path.js";
import { isConfigValue } from "./value.js";
import type { CoercionRule, ConfigIssue, ConfigValue, ProvenanceEvent } from "./types.js";

export interface ApplyCoercionRulesInput {
  readonly config: ConfigValue;
  readonly rules: readonly CoercionRule[];
}

export interface ApplyCoercionRulesResult {
  readonly issues: readonly ConfigIssue[];
  readonly provenance: readonly ProvenanceEvent[];
}

export function applyCoercionRules(input: ApplyCoercionRulesInput): ApplyCoercionRulesResult {
  const issues: ConfigIssue[] = [];
  const provenance: ProvenanceEvent[] = [];

  if (input.rules.length === 0) {
    return { issues, provenance };
  }

  if (input.config === null || typeof input.config !== "object" || Array.isArray(input.config)) {
    return {
      issues: [
        {
          category: "coercion",
          code: "root_not_object",
          severity: "error",
          message: "Coercion requires an object config root."
        }
      ],
      provenance
    };
  }

  for (const rule of input.rules) {
    const currentValue = getConfigValueAtPath(input.config, rule.path);
    if (currentValue === undefined) {
      continue;
    }

    if (typeof currentValue !== rule.from) {
      continue;
    }

    const stringValue = currentValue as string;
    const coerced = coerceString(stringValue, rule);
    if (!coerced.ok) {
      issues.push({
        category: "coercion",
        code: "coercion_failed",
        severity: "error",
        path: rule.path,
        message: coerced.message
      });
      continue;
    }

    try {
      setConfigValueAtPath(input.config as Record<string, ConfigValue>, rule.path, coerced.value);
      provenance.push({
        path: rule.path,
        action: "coerced",
        sourceId: "core:coercion",
        message: `Path was coerced from ${rule.from} to ${rule.to}.`
      });
    } catch (error) {
      issues.push({
        category: "coercion",
        code: "coercion_set_failed",
        severity: "error",
        path: rule.path,
        message: error instanceof Error ? error.message : "Failed to set coerced config value."
      });
    }
  }

  return { issues, provenance };
}

function coerceString(
  value: string,
  rule: CoercionRule
): { readonly ok: true; readonly value: ConfigValue } | { readonly ok: false; readonly message: string } {
  switch (rule.to) {
    case "number": {
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue)) {
        return { ok: false, message: "Expected a finite number." };
      }
      return { ok: true, value: numericValue };
    }
    case "boolean": {
      if (value === "true") {
        return { ok: true, value: true };
      }
      if (value === "false") {
        return { ok: true, value: false };
      }
      return { ok: false, message: "Expected true or false." };
    }
    case "json":
      return coerceJson(value);
  }
}

function coerceJson(
  value: string
): { readonly ok: true; readonly value: ConfigValue } | { readonly ok: false; readonly message: string } {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isConfigValue(parsed)) {
      return { ok: false, message: "Expected JSON-compatible value." };
    }
    return { ok: true, value: parsed };
  } catch {
    return { ok: false, message: "Expected valid JSON." };
  }
}
