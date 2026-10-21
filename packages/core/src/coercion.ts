import { cloneConfigValue, getConfigValueAtPath, isUnsafePathSegment } from "./path.js";
import { parseJsonConfigValue } from "./json-value.js";
import { appendBoundedIssues, isDiagnosticsLimitReached } from "./diagnostics.js";
import { normalizeResourceLimits } from "./limits.js";
import type { CoercionRule, ConfigIssue, ConfigPath, ConfigValue, ProvenanceEvent, ResourceLimitPolicy } from "./types.js";

export interface ApplyCoercionRulesInput {
  readonly config: ConfigValue;
  readonly rules: readonly CoercionRule[];
  readonly limits?: Partial<ResourceLimitPolicy>;
  /** Existing history shares the event budget; returned provenance contains only new events. */
  readonly provenance?: readonly ProvenanceEvent[];
}

export interface ApplyCoercionRulesResult {
  readonly config: ConfigValue;
  readonly issues: readonly ConfigIssue[];
  readonly provenance: readonly ProvenanceEvent[];
}

export function applyCoercionRules(input: ApplyCoercionRulesInput): ApplyCoercionRulesResult {
  const issues: ConfigIssue[] = [];
  const provenance: ProvenanceEvent[] = [];
  const limits = normalizeResourceLimits(input.limits);
  // Include no-op rules in the execution bound, before copying or inspecting config.
  if (input.rules.length > limits.maxProvenanceEvents) {
    return { config: {}, issues: [resourceIssue("max_coercion_rules_exceeded", limits.maxProvenanceEvents)], provenance };
  }
  const remainingEvents = limits.maxProvenanceEvents - (input.provenance?.length ?? 0);
  if (remainingEvents < 0) {
    return { config: {}, issues: [resourceIssue("max_provenance_events_exceeded", limits.maxProvenanceEvents)], provenance };
  }
  const config = cloneConfigValue(input.config);

  if (input.rules.length === 0) {
    return { config, issues, provenance };
  }

  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    return {
      config,
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
    if (isDiagnosticsLimitReached(issues, limits.maxDiagnostics)) break;
    const currentValue = getConfigValueAtPath(config, rule.path);
    if (currentValue === undefined) {
      continue;
    }

    if (typeof currentValue !== rule.from) {
      continue;
    }

    if (provenance.length >= remainingEvents) {
      appendBoundedIssues(issues, [resourceIssue("max_provenance_events_exceeded", limits.maxProvenanceEvents)], limits.maxDiagnostics);
      break;
    }

    const stringValue = currentValue as string;
    const coerced = coerceString(stringValue, rule);
    if (!coerced.ok) {
      appendBoundedIssues(issues, [{
        category: "coercion",
        code: coerced.code ?? "coercion_failed",
        severity: "error",
        path: [...rule.path],
        message: coerced.message
      }], limits.maxDiagnostics);
      continue;
    }

    try {
      setExistingCoercionValue(config, rule.path, coerced.value);
      provenance.push({
        path: [...rule.path],
        action: "coerced",
        sourceId: "core:coercion",
        message: `Path was coerced from ${rule.from} to ${rule.to}.`
      });
    } catch {
      appendBoundedIssues(issues, [{
        category: "coercion",
        code: "coercion_set_failed",
        severity: "error",
        path: [...rule.path],
        message: "Failed to set coerced config value. Internal exception details were omitted from diagnostics."
      }], limits.maxDiagnostics);
    }
  }

  return { config, issues, provenance };
}

function resourceIssue(code: string, maximum: number): ConfigIssue {
  return { category: "resource-limit", code, severity: "error",
    message: `Coercion exceeded its configured budget of ${maximum}.` };
}

function setExistingCoercionValue(config: ConfigValue, path: ConfigPath, value: ConfigValue): void {
  const parent = getConfigValueAtPath(config, path.slice(0, -1));
  const segment = path[path.length - 1];
  if (Array.isArray(parent) && typeof segment === "number" && Number.isSafeInteger(segment) &&
      segment >= 0 && segment < parent.length && Object.prototype.hasOwnProperty.call(parent, segment)) {
    (parent as ConfigValue[])[segment] = cloneConfigValue(value);
    return;
  }
  if (parent !== null && typeof parent === "object" && !Array.isArray(parent) &&
      typeof segment === "string" && !isUnsafePathSegment(segment) &&
      Object.prototype.hasOwnProperty.call(parent, segment)) {
    (parent as Record<string, ConfigValue>)[segment] = cloneConfigValue(value);
    return;
  }
  throw new Error("Coercion requires an existing object field or array element.");
}

function coerceString(
  value: string,
  rule: CoercionRule
): { readonly ok: true; readonly value: ConfigValue } | { readonly ok: false; readonly message: string; readonly code?: string } {
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
): { readonly ok: true; readonly value: ConfigValue } | { readonly ok: false; readonly message: string; readonly code?: string } {
  const parsed = parseJsonConfigValue(value);
  if (parsed.ok) return parsed;
  if (parsed.reason === "unsafe-key") {
    return { ok: false, code: "unsafe_key", message: "JSON value contains an unsafe object key." };
  }
  return {
    ok: false,
    message: parsed.reason === "invalid-json" ? "Expected valid JSON." : "Expected JSON-compatible value."
  };
}
