import { isUnsafePathSegment } from "./path.js";
import { isConfigValue } from "./value.js";
import type { ConfigValue } from "./types.js";

type JsonValueResult =
  | { readonly ok: true; readonly value: ConfigValue }
  | { readonly ok: false; readonly reason: "invalid-json" | "invalid-value" | "unsafe-key" };

/** Shared JSON checks; callers own stage-specific issue codes and messages. */
export function parseJsonConfigValue(raw: string): JsonValueResult {
  let parsed: unknown;
  try {
    // A reviver recursively visits containers and can reject valid deep JSON.
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "invalid-json" };
  }

  const stack: Iterator<unknown>[] = [[parsed].values()];
  while (stack.length > 0) {
    const next = stack[stack.length - 1]!.next();
    if (next.done) {
      stack.pop();
      continue;
    }
    const value = next.value;
    if (value === null || typeof value !== "object") continue;
    if (!Array.isArray(value) && Object.keys(value).some(isUnsafePathSegment)) {
      return { ok: false, reason: "unsafe-key" };
    }
    stack.push(Array.isArray(value) ? value.values() : Object.values(value).values());
  }
  if (!isConfigValue(parsed)) return { ok: false, reason: "invalid-value" };
  return { ok: true, value: parsed };
}
