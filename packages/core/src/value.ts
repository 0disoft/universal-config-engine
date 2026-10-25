import { markDiagnosticsOverflow } from "./diagnostics.js";
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
  if (value === null || typeof value !== "object") return isConfigScalar(value);

  const ancestors = new WeakSet<object>();
  const validated = new WeakSet<object>();
  const stack: { readonly container?: object; readonly values: Iterator<unknown> }[] = [
    { values: [value].values() }
  ];

  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;
    const next = frame.values.next();
    if (next.done) {
      stack.pop();
      if (frame.container !== undefined) {
        ancestors.delete(frame.container);
        validated.add(frame.container);
      }
      continue;
    }

    const child = next.value;
    if (child === null || typeof child !== "object") {
      if (!isConfigScalar(child)) return false;
      continue;
    }
    if (!Array.isArray(child) && !isPlainConfigObject(child)) return false;
    if (ancestors.has(child)) return false;
    if (validated.has(child)) continue;

    ancestors.add(child);
    // Array iterators visit holes as undefined; Array.every would skip them.
    const children = Array.isArray(child) ? child : Object.values(child);
    stack.push({ container: child, values: Array.prototype.values.call(children) });
  }
  return true;
}

function isConfigScalar(value: unknown): boolean {
  return value === null || typeof value === "string" || typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value));
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

  walk(sourceId, value, limits, state);
  return state;
}

function walk(
  sourceId: string,
  value: unknown,
  limits: ResourceLimitPolicy,
  state: ValidationState
): void {
  const path: (string | number)[] = [];
  const ancestors = new WeakSet<object>();
  const stack: {
    readonly source: object;
    readonly keys: Iterator<string | number>;
    readonly array: boolean;
    readonly snapshot: ConfigValue | undefined;
    readonly emitEntries: boolean;
    readonly initialIssueCount: number;
  }[] = [];

  function issue(category: ConfigIssue["category"], code: string, message: string): void {
    state.issues.push({ category, code, severity: "error", sourceId, path: [...path], message });
  }

  function capture(key: string | number | undefined, child: ConfigValue): void {
    const snapshot = stack[stack.length - 1]?.snapshot;
    if (key !== undefined && snapshot !== undefined) {
      (snapshot as Record<string | number, ConfigValue>)[key] = child;
    }
  }

  function enter(input: unknown, emitEntries: boolean, key?: string | number): boolean {
    if (state.issues.length >= limits.maxDiagnostics) {
      markDiagnosticsOverflow(state.issues, limits.maxDiagnostics);
      return false;
    }
    if (path.length > limits.maxDepth) {
      issue("resource-limit", "max_depth_exceeded", `Config depth exceeds the maximum depth of ${limits.maxDepth}.`);
      return false;
    }
    if (path.length > limits.maxPathLength) {
      issue("resource-limit", "max_path_length_exceeded",
        `Config path ${formatPath(path)} exceeds the maximum path length of ${limits.maxPathLength}.`);
      return false;
    }
    // Nested values are fetched only after admission, never through prototypes.
    const child = key === undefined ? input : Object.hasOwn(input as object, key)
      ? (input as Readonly<Record<string | number, unknown>>)[key] : undefined;
    if (child !== null && typeof child === "object") {
      if (ancestors.has(child)) {
        issue("parse", "cyclic_value", `Config value at ${formatPath(path)} contains a cycle.`);
        return false;
      }
      const array = Array.isArray(child);
      if (!array && !isPlainConfigObject(child)) {
        issue("parse", "invalid_value", `Config value at ${formatPath(path)} is not JSON-compatible.`);
        return false;
      }
      const keys = array ? undefined : Object.keys(child);
      // Own atomic arrays and their descendants during the admitted read. A later
      // count/clone must never evaluate caller accessors again after validation.
      const snapshot: ConfigValue | undefined = array && emitEntries || stack[stack.length - 1]?.snapshot !== undefined
        ? array ? [] : Object.create(null) as Record<string, ConfigValue> : undefined;
      if (snapshot !== undefined) capture(key, snapshot);
      if (keys?.length === 0) {
        if (path.length > 0 && emitEntries) state.entries.push({ path: [...path], value: {} });
        return false;
      }
      ancestors.add(child);
      stack.push({ source: child, array, snapshot, emitEntries, initialIssueCount: state.issues.length,
        keys: array ? Array.prototype.keys.call(child) : keys!.values() });
      return true;
    }
    if (!isConfigValue(child)) {
      issue("parse", "invalid_value", `Config value at ${formatPath(path)} is not JSON-compatible.`);
    } else {
      capture(key, child);
      if (emitEntries) state.entries.push({ path: [...path], value: child });
    }
    return false;
  }

  function leave(complete: boolean): void {
    const frame = stack.pop()!;
    if (complete && frame.array && frame.emitEntries && state.issues.length === frame.initialIssueCount) {
      state.entries.push({ path: [...path], value: frame.snapshot! });
    }
    ancestors.delete(frame.source);
    if (stack.length > 0) path.pop();
  }

  enter(value, true);
  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;
    const next = frame.keys.next();
    if (next.done) {
      leave(true);
      continue;
    }
    if (state.issues.length >= limits.maxDiagnostics) {
      markDiagnosticsOverflow(state.issues, limits.maxDiagnostics);
      leave(false);
      continue;
    }
    const key = next.value;
    path.push(key);
    // Count every expanded slot, including repeated references and array indexes,
    // before merge can clone an atomic array into an exponentially larger tree.
    state.keyCount += 1;
    if (state.keyCount > limits.maxKeyCount) {
      issue("resource-limit", "max_key_count_exceeded", `Config key/index count exceeds the maximum of ${limits.maxKeyCount}.`);
      path.pop();
      while (stack.length > 0) leave(false);
      break;
    }
    if (!frame.array) {
      if (isUnsafePathSegment(key)) {
        issue("merge", "unsafe_key", `Unsafe config path segment ${key} is rejected.`);
        path.pop();
        continue;
      }
    }
    // enter checks path budgets before fetching this property's value.
    if (!enter(frame.source, frame.emitEntries && !frame.array, key)) path.pop();
  }
}
