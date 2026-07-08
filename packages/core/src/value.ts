import { formatPath, isUnsafePathSegment } from "./path.js";
import type { ConfigIssue, ConfigPath, ConfigValue, ResourceLimitPolicy } from "./types.js";

export interface FlattenedConfigEntry {
  readonly path: ConfigPath;
  readonly value: ConfigValue;
}

interface ValidationState {
  readonly issues: ConfigIssue[];
  readonly entries: FlattenedConfigEntry[];
  keyCount: number;
}

export function isPlainConfigObject(value: unknown): value is { readonly [key: string]: ConfigValue } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function isConfigValue(value: unknown): value is ConfigValue {
  if (value === null) {
    return true;
  }

  const valueType = typeof value;
  if (valueType === "string" || valueType === "number" || valueType === "boolean") {
    return Number.isFinite(value as number) || valueType !== "number";
  }

  if (Array.isArray(value)) {
    return value.every((item) => isConfigValue(item));
  }

  if (isPlainConfigObject(value)) {
    return Object.values(value).every((child) => isConfigValue(child));
  }

  return false;
}

export function flattenConfigObject(
  sourceId: string,
  value: unknown,
  limits: ResourceLimitPolicy
): { readonly entries: readonly FlattenedConfigEntry[]; readonly issues: readonly ConfigIssue[] } {
  const state: ValidationState = {
    issues: [],
    entries: [],
    keyCount: 0
  };
  const seen = new WeakSet<object>();

  if (!isPlainConfigObject(value)) {
    state.issues.push({
      category: "parse",
      code: "root_not_object",
      severity: "error",
      sourceId,
      message: "Source value must be a normalized config object."
    });
    return state;
  }

  walk(sourceId, value, [], 0, limits, state, seen, true);
  return state;
}

function walk(
  sourceId: string,
  value: unknown,
  path: ConfigPath,
  depth: number,
  limits: ResourceLimitPolicy,
  state: ValidationState,
  seen: WeakSet<object>,
  emitEntries: boolean
): void {
  if (state.issues.length >= limits.maxDiagnostics) {
    return;
  }

  if (depth > limits.maxDepth) {
    state.issues.push({
      category: "resource-limit",
      code: "max_depth_exceeded",
      severity: "error",
      sourceId,
      path,
      message: `Config depth exceeds the maximum depth of ${limits.maxDepth}.`
    });
    return;
  }

  if (path.length > limits.maxPathLength) {
    state.issues.push({
      category: "resource-limit",
      code: "max_path_length_exceeded",
      severity: "error",
      sourceId,
      path,
      message: `Config path ${formatPath(path)} exceeds the maximum path length of ${limits.maxPathLength}.`
    });
    return;
  }

  if (value !== null && typeof value === "object") {
    if (seen.has(value)) {
      state.issues.push({
        category: "parse",
        code: "cyclic_value",
        severity: "error",
        sourceId,
        path,
        message: `Config value at ${formatPath(path)} contains a cycle.`
      });
      return;
    }
    seen.add(value);
  }

  if (Array.isArray(value)) {
    validateArray(sourceId, value, path, depth, limits, state, seen);
    if (emitEntries) {
      state.entries.push({ path, value });
    }
    return;
  }

  if (isPlainConfigObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0 && path.length > 0 && emitEntries) {
      state.entries.push({ path, value: {} });
      return;
    }

    for (const [key, child] of entries) {
      state.keyCount += 1;
      const childPath = [...path, key];

      if (state.keyCount > limits.maxKeyCount) {
        state.issues.push({
          category: "resource-limit",
          code: "max_key_count_exceeded",
          severity: "error",
          sourceId,
          path: childPath,
          message: `Config key count exceeds the maximum of ${limits.maxKeyCount}.`
        });
        return;
      }

      if (isUnsafePathSegment(key)) {
        state.issues.push({
          category: "merge",
          code: "unsafe_key",
          severity: "error",
          sourceId,
          path: childPath,
          message: `Unsafe config path segment ${key} is rejected.`
        });
        continue;
      }

      if (isPlainConfigObject(child)) {
        walk(sourceId, child, childPath, depth + 1, limits, state, seen, emitEntries);
      } else if (Array.isArray(child)) {
        walk(sourceId, child, childPath, depth + 1, limits, state, seen, emitEntries);
      } else if (isConfigValue(child)) {
        if (emitEntries) {
          state.entries.push({ path: childPath, value: child });
        }
      } else {
        state.issues.push({
          category: "parse",
          code: "invalid_value",
          severity: "error",
          sourceId,
          path: childPath,
          message: `Config value at ${formatPath(childPath)} is not JSON-compatible.`
        });
      }
    }
    return;
  }

  if (!isConfigValue(value)) {
    state.issues.push({
      category: "parse",
      code: "invalid_value",
      severity: "error",
      sourceId,
      path,
      message: `Config value at ${formatPath(path)} is not JSON-compatible.`
    });
  }
}

function validateArray(
  sourceId: string,
  value: readonly unknown[],
  path: ConfigPath,
  depth: number,
  limits: ResourceLimitPolicy,
  state: ValidationState,
  seen: WeakSet<object>
): void {
  for (const [index, child] of value.entries()) {
    walk(sourceId, child, [...path, index], depth + 1, limits, state, seen, false);
  }
}
