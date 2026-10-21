import { isConfigPath, isIssueCode, isRecord } from "./adapter-guards.js";
import { buildConfigDiff, configValuesEqual, diffFailure, type BuildConfigDiffOptions, type ConfigDiff } from "./diff.js";
import { getConfigValueAtPath, isPathPrefix, isUnsafePathSegment } from "./path.js";
import type { ConfigPath, ConfigResult } from "./types.js";

export type ConfigChangeRule = {
  readonly id: string;
  readonly path: ConfigPath;
} & (
  | { readonly mode: "forbid-changes" | "require-path" }
  | { readonly mode: "allowed-sources"; readonly allowedSourceIds: readonly string[] }
);

export interface ConfigChangePolicy {
  readonly version: "change-policy-1";
  readonly rules: readonly ConfigChangeRule[];
}

export interface ConfigPolicyViolation {
  readonly code: "change_forbidden" | "required_path_missing" | "source_not_allowed" | "comparison_indeterminate"
    | "invalid_policy" | "comparison_failed" | "max_report_bytes_exceeded";
  readonly ruleId?: string;
  readonly path?: ConfigPath;
}

export interface ConfigChangeCheck {
  readonly schemaVersion: "change-check-1";
  readonly status: "ok" | "error";
  readonly diff: ConfigDiff;
  readonly policy: {
    readonly status: "passed" | "failed" | "error";
    readonly violations: readonly ConfigPolicyViolation[];
  };
}

/** Policy always evaluates the complete configuration; a query cannot hide changes. */
export function checkConfigChanges(
  before: ConfigResult,
  after: ConfigResult,
  policy: unknown,
  options: Omit<BuildConfigDiffOptions, "path"> = {}
): ConfigChangeCheck {
  const { path: _ignored, ...rootOptions } = options as BuildConfigDiffOptions;
  const diff = buildConfigDiff(before, after, rootOptions);
  const normalized = parsePolicy(policy);
  let evaluation: ConfigChangeCheck["policy"];
  if (diff.status === "error") evaluation = { status: "error", violations: [{ code: "comparison_failed" }] };
  else if (normalized === undefined) evaluation = { status: "error", violations: [{ code: "invalid_policy" }] };
  else {
    const violations: ConfigPolicyViolation[] = [];
    for (const rule of normalized.rules) {
      const code = evaluateRule(rule, diff, before, after);
      if (code !== undefined) violations.push({ code, ruleId: rule.id, path: [...rule.path] });
    }
    evaluation = { status: violations.length === 0 ? "passed" : "failed", violations };
  }
  const report: ConfigChangeCheck = {
    schemaVersion: "change-check-1", status: diff.status === "ok" && evaluation.status === "passed" ? "ok" : "error",
    diff, policy: evaluation
  };
  const maxBytes = Math.min(before.limits.maxReportBytes, after.limits.maxReportBytes);
  if (new TextEncoder().encode(JSON.stringify(report)).byteLength <= maxBytes) return report;
  return { ...report, status: "error", diff: diffFailure(diff, "max_report_bytes_exceeded", 0),
    policy: { status: "error", violations: [{ code: "max_report_bytes_exceeded" }] } };
}

function evaluateRule(rule: ConfigChangeRule, diff: ConfigDiff, before: ConfigResult, after: ConfigResult): ConfigPolicyViolation["code"] | undefined {
  if (rule.mode === "require-path") {
    return getConfigValueAtPath(after.config, rule.path) === undefined ? "required_path_missing" : undefined;
  }
  if (rule.mode === "allowed-sources") {
    return after.resolvedPaths.some((entry) => intersects(rule.path, entry.path) && !rule.allowedSourceIds.includes(entry.winningSourceId))
      ? "source_not_allowed" : undefined;
  }
  const previous = getConfigValueAtPath(before.config, rule.path);
  const next = getConfigValueAtPath(after.config, rule.path);
  if (previous === undefined || next === undefined) return previous === next ? undefined : "change_forbidden";
  const unknown = diff.uncomparedSecretPaths.some((path) => intersects(rule.path, path));
  const knownChanges = diff.changes.filter((change) => intersects(rule.path, change.path));
  if (unknown) return knownChanges.length > 0 ? "change_forbidden" : "comparison_indeterminate";
  if (!configValuesEqual(previous, next) || knownChanges.some((change) => change.kinds.includes("source-changed"))) return "change_forbidden";
  return undefined;
}

function intersects(left: ConfigPath, right: ConfigPath) {
  return isPathPrefix(left, right) || isPathPrefix(right, left);
}

function parsePolicy(value: unknown): ConfigChangePolicy | undefined {
  try {
    if (!isRecord(value) || value.version !== "change-policy-1" ||
      !Object.hasOwn(value, "version") || !Object.hasOwn(value, "rules") ||
      Object.keys(value).some((key) => key !== "version" && key !== "rules")) return undefined;
    const inputRules = boundedArray(value.rules, 256);
    if (inputRules === undefined) return undefined;
    const ids = new Set<string>();
    const rules: ConfigChangeRule[] = [];
    for (const rule of inputRules) {
      if (!isRecord(rule) || !Object.hasOwn(rule, "id") || !Object.hasOwn(rule, "path") || !Object.hasOwn(rule, "mode")) return undefined;
      const { id, mode } = rule;
      const path = boundedArray(rule.path, 256);
      if (!isIssueCode(id) || ids.has(id) || !isConfigPath(path) || path.length > 256 || path.some(isUnsafePathSegment) ||
        new TextEncoder().encode(JSON.stringify(path)).byteLength > 4096) return undefined;
      ids.add(id);
      const keys = mode === "allowed-sources" ? ["id", "path", "mode", "allowedSourceIds"] : ["id", "path", "mode"];
      if (Object.keys(rule).some((key) => !keys.includes(key))) return undefined;
      if (mode === "allowed-sources") {
        if (!Object.hasOwn(rule, "allowedSourceIds")) return undefined;
        const allowedSourceIds = boundedArray(rule.allowedSourceIds, 64);
        if (allowedSourceIds === undefined || allowedSourceIds.length === 0 ||
          allowedSourceIds.some((sourceId) => typeof sourceId !== "string" || sourceId.length === 0 || sourceId.length > 1024)) return undefined;
        rules.push({ id, path, mode, allowedSourceIds: allowedSourceIds as string[] });
      } else if (mode === "forbid-changes" || mode === "require-path") rules.push({ id, path, mode });
      else return undefined;
    }
    return { version: "change-policy-1", rules };
  } catch { return undefined; }
}

function boundedArray(value: unknown, maxLength: number): unknown[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const length = value.length;
  if (!Number.isSafeInteger(length) || length < 0 || length > maxLength) return undefined;
  const copy: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    if (!Object.hasOwn(value, index)) return undefined;
    copy.push(value[index]);
  }
  return copy;
}
