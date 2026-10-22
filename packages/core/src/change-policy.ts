import { isConfigPath, isIssueCode, isRecord } from "./adapter-guards.js";
import { buildConfigDiff, configValuesEqual, diffFailure, type BuildConfigDiffOptions, type ConfigDiff } from "./diff.js";
import { getConfigValueAtPath, isUnsafePathSegment, pathToKey } from "./path.js";
import type { ConfigPath, ConfigResult, ResolvedPath } from "./types.js";
import { sourceIdentity } from "./source-identity.js";
import { PathIntersectionIndex } from "./path-intersection-index.js";

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
    const evaluateRule = createRuleEvaluator(diff, before, after);
    for (const rule of normalized.rules) {
      const code = evaluateRule(rule);
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

function createRuleEvaluator(diff: ConfigDiff, before: ConfigResult, after: ConfigResult) {
  const unknown = new PathIntersectionIndex(diff.uncomparedSecretPaths, path => path);
  const changes = new PathIntersectionIndex(diff.changes, change => change.path);
  const sourceChanges = new PathIntersectionIndex(diff.changes.filter(change => change.kinds.includes("source-changed")), change => change.path);
  const equality = new Map<string, boolean>();
  let sources: Map<string, PathIntersectionIndex<ResolvedPath>> | undefined;
  const ownership = new Map<ConfigResult, { index: PathIntersectionIndex<ResolvedPath>; priorities: Map<string, number>; cache: Map<string, string> }>();
  function ownershipAtPath(result: ConfigResult, path: ConfigPath): string {
    let state = ownership.get(result);
    if (state === undefined) {
      state = { index: new PathIntersectionIndex(result.resolvedPaths, entry => entry.path),
        priorities: new Map(result.sources.map(source => [source.id, source.priority])), cache: new Map() };
      ownership.set(result, state);
    }
    const key = pathToKey(path);
    let value = state.cache.get(key);
    if (value === undefined) {
      value = JSON.stringify(state.index.related(path).map(entry =>
        JSON.stringify([entry.path, sourceIdentity(entry, state.priorities)])).sort());
      state.cache.set(key, value);
    }
    return value;
  }
  return function evaluateRule(rule: ConfigChangeRule): ConfigPolicyViolation["code"] | undefined {
    if (rule.mode === "require-path") {
      return getConfigValueAtPath(after.config, rule.path) === undefined ? "required_path_missing" : undefined;
    }
    if (rule.mode === "allowed-sources") {
      if (sources === undefined) {
        const grouped = new Map<string, ResolvedPath[]>();
        for (const entry of after.resolvedPaths) {
          const entries = grouped.get(entry.winningSourceId) ?? [];
          entries.push(entry); grouped.set(entry.winningSourceId, entries);
        }
        sources = new Map([...grouped].map(([id, entries]) => [id, new PathIntersectionIndex(entries, entry => entry.path)]));
      }
      const allowed = new Set(rule.allowedSourceIds);
      for (const [id, index] of sources) {
        if (!allowed.has(id) && index.intersects(rule.path)) return "source_not_allowed";
      }
      return undefined;
    }
    const previous = getConfigValueAtPath(before.config, rule.path);
    const next = getConfigValueAtPath(after.config, rule.path);
    if (previous === undefined || next === undefined) return previous === next ? undefined : "change_forbidden";
    if (unknown.intersects(rule.path)) return changes.intersects(rule.path) ? "change_forbidden" : "comparison_indeterminate";
    const key = pathToKey(rule.path);
    let equal = equality.get(key);
    if (equal === undefined) { equal = configValuesEqual(previous, next); equality.set(key, equal); }
    if (!equal || sourceChanges.intersects(rule.path) &&
        ownershipAtPath(before, rule.path) !== ownershipAtPath(after, rule.path)) return "change_forbidden";
    return undefined;
  };
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
