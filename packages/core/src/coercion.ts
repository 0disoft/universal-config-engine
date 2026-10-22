import { cloneConfigValue, getConfigValueAtPath, isUnsafePathSegment } from "./path.js";
import { parseJsonConfigValue } from "./json-value.js";
import { appendBoundedIssues, isDiagnosticsLimitReached } from "./diagnostics.js";
import { nestedKeyCount } from "./merge-key-budget.js";
import { flattenConfigObject } from "./value.js";
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
  return coerce(input, false);
}

/** Internal resolution boundary; standalone coercion keeps its existing depth contract. */
export function applyResolutionCoercionRules(input: ApplyCoercionRulesInput): ApplyCoercionRulesResult {
  return coerce(input, true);
}

function coerce(input: ApplyCoercionRulesInput, enforceStructure: boolean): ApplyCoercionRulesResult {
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

  let keyCount = enforceStructure ? nestedKeyCount(config) : 0;
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

    let addedKeys = 0;
    if (enforceStructure && rule.to === "json") {
      // The replaced value is a string, so only its newly decoded descendants
      // grow the tree. Inspect that candidate, never the whole config per rule.
      const checked = flattenConfigObject("core:resolved-config", { value: coerced.value }, {
        ...limits, maxKeyCount: limits.maxKeyCount - keyCount + 1,
        maxDepth: limits.maxDepth - rule.path.length + 1,
        maxPathLength: limits.maxPathLength - rule.path.length + 1
      });
      if (checked.issues.length > 0) {
        appendBoundedIssues(issues, checked.issues.map(issue => ({
          ...issue, path: [...rule.path, ...(issue.path?.slice(1) ?? [])],
          message: "JSON coercion would exceed the resolved config structure budget."
        })), limits.maxDiagnostics);
        break;
      }
      addedKeys = nestedKeyCount(coerced.value);
    }
    try {
      setExistingCoercionValue(config, rule.path, coerced.value);
      keyCount += addedKeys;
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
