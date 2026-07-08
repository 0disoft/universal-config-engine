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
      if (typeof segment !== "number") {
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

  let current: Record<string, ConfigValue> = root;

  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index];
    if (segment === undefined) {
      throw new Error("Config path contained an undefined segment.");
    }
    assertSafeObjectPathSegment(segment);
    if (typeof segment !== "string") {
      throw new Error(`Object merge paths cannot create numeric segment ${String(segment)}.`);
    }

    const existing = Object.prototype.hasOwnProperty.call(current, segment) ? current[segment] : undefined;
    if (existing === undefined || existing === null || typeof existing !== "object" || Array.isArray(existing)) {
      const next = createConfigObject();
      current[segment] = next;
      current = next;
      continue;
    }

    current = existing as Record<string, ConfigValue>;
  }

  const finalSegment = path[path.length - 1];
  if (finalSegment === undefined) {
    throw new Error("Config path contained an undefined final segment.");
  }
  assertSafeObjectPathSegment(finalSegment);
  if (typeof finalSegment !== "string") {
    throw new Error(`Object merge paths cannot set numeric segment ${String(finalSegment)}.`);
  }

  current[finalSegment] = cloneConfigValue(value);
}

export function cloneConfigValue(value: ConfigValue): ConfigValue {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => cloneConfigValue(item));
  }

  const output = createConfigObject();
  for (const [key, child] of Object.entries(value)) {
    assertSafeObjectPathSegment(key);
    output[key] = cloneConfigValue(child);
  }
  return output;
}

function assertSafeObjectPathSegment(segment: ConfigPathSegment): void {
  if (isUnsafePathSegment(segment)) {
    throw new Error(`Unsafe config path segment ${String(segment)} is rejected.`);
  }
}

function createConfigObject(): Record<string, ConfigValue> {
  return Object.create(null) as Record<string, ConfigValue>;
}
