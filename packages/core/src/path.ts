import type { ConfigPath, ConfigPathSegment, ConfigValue } from "./types.js";

const UNSAFE_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

export function isUnsafePathSegment(segment: ConfigPathSegment): boolean {
  return typeof segment === "string" && UNSAFE_PATH_SEGMENTS.has(segment);
}

export function pathToKey(path: ConfigPath): string {
  return JSON.stringify(path);
}

export function formatPath(path: ConfigPath): string {
  if (path.length === 0) {
    return "<root>";
  }

  return path.map(String).join(".");
}

export function pathsEqual(left: ConfigPath, right: ConfigPath): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}

export function isPathPrefix(prefix: ConfigPath, path: ConfigPath): boolean {
  return prefix.length <= path.length && prefix.every((segment, index) => segment === path[index]);
}

export function getConfigValueAtPath(value: ConfigValue, path: ConfigPath): ConfigValue | undefined {
  let current: ConfigValue | undefined = value;

  for (const segment of path) {
    if (isUnsafePathSegment(segment)) {
      return undefined;
    }

    if (current === null || current === undefined) {
      return undefined;
    }

    if (Array.isArray(current)) {
      if (typeof segment !== "number" || !Number.isSafeInteger(segment) || segment < 0 ||
          segment >= current.length || !Object.prototype.hasOwnProperty.call(current, segment)) {
        return undefined;
      }
      current = current[segment];
      continue;
    }

    if (typeof current === "object") {
      if (typeof segment !== "string") {
        return undefined;
      }
      if (!Object.prototype.hasOwnProperty.call(current, segment)) {
        return undefined;
      }
      current = (current as { readonly [key: string]: ConfigValue })[segment];
      continue;
    }

    return undefined;
  }

  return current;
}

export function setConfigValueAtPath(
  root: Record<string, ConfigValue>,
  path: ConfigPath,
  value: ConfigValue
): void {
  if (path.length === 0) {
    throw new Error("Cannot set the root path through setConfigValueAtPath.");
  }

  // Validate and own all inputs before replacing any existing ancestor.
  for (let index = 0; index < path.length; index += 1) {
    const segment = path[index];
    if (segment === undefined) {
      throw new Error("Config path contained an undefined segment.");
    }
    assertSafeObjectPathSegment(segment);
    if (typeof segment !== "string") {
      throw new Error(`Object merge paths cannot write numeric segment ${String(segment)}.`);
    }
  }
  const ownedValue = cloneConfigValue(value);
  let current: Record<string, ConfigValue> = root;

  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index] as string;
    const existing = Object.prototype.hasOwnProperty.call(current, segment) ? current[segment] : undefined;
    if (existing === undefined || existing === null || typeof existing !== "object" || Array.isArray(existing)) {
      const next = createConfigObject();
      current[segment] = next;
      current = next;
      continue;
    }

    current = existing as Record<string, ConfigValue>;
  }

  current[path[path.length - 1] as string] = ownedValue;
}

export function cloneConfigValue(value: ConfigValue): ConfigValue {
  if (value === null || typeof value !== "object") {
    return value;
  }

  const root = createCloneFrame(value);
  const stack = [root];
  const ancestors = new WeakSet<object>([value]);
  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;
    const next = frame.entries.next();
    if (next.done) {
      ancestors.delete(frame.source);
      stack.pop();
      continue;
    }
    const [key, child] = next.value;
    // Match Array.map's hole preservation; array metadata is not config data.
    if (Array.isArray(frame.source) && !(key in frame.source)) continue;
    assertSafeObjectPathSegment(key);
    if (child === null || typeof child !== "object") {
      frame.output[key] = child;
      continue;
    }
    if (ancestors.has(child)) throw new Error("Cyclic config values cannot be cloned.");
    const childFrame = createCloneFrame(child);
    frame.output[key] = childFrame.output;
    ancestors.add(child);
    stack.push(childFrame);
  }
  return root.output;
}

function createCloneFrame(value: object): {
  readonly source: object;
  readonly output: Record<string, ConfigValue>;
  readonly entries: Iterator<readonly [string | number, ConfigValue]>;
} {
  return {
    source: value,
    output: Array.isArray(value) ? new Array(value.length) as unknown as Record<string, ConfigValue> : createConfigObject(),
    entries: Array.isArray(value) ? Array.prototype.entries.call(value) : Object.entries(value).values()
  };
}

function assertSafeObjectPathSegment(segment: ConfigPathSegment): void {
  if (isUnsafePathSegment(segment)) {
    throw new Error(`Unsafe config path segment ${String(segment)} is rejected.`);
  }
}

function createConfigObject(): Record<string, ConfigValue> {
  return Object.create(null) as Record<string, ConfigValue>;
}
