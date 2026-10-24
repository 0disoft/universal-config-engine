import { isUnsafePathSegment } from "./path.js";
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

  // Native parsing already guarantees an acyclic tree of JSON types. Numeric
  // overflow and unsafe keys are the remaining checks; no generic second walk
  // or ancestor/visited sets are needed for this parser-owned value.
  let invalidNumber = false;
  const stack: Iterator<unknown>[] = [[parsed].values()];
  while (stack.length > 0) {
    const next = stack[stack.length - 1]!.next();
    if (next.done) {
      stack.pop();
      continue;
    }
    const value = next.value;
    if (typeof value === "number" && !Number.isFinite(value)) invalidNumber = true;
    if (value === null || typeof value !== "object") continue;
    if (!Array.isArray(value) && Object.keys(value).some(isUnsafePathSegment)) {
      return { ok: false, reason: "unsafe-key" };
    }
    stack.push(Array.isArray(value) ? value.values() : Object.values(value).values());
  }
  // Keep unsafe-key precedence even if an earlier scalar overflowed.
  if (invalidNumber) return { ok: false, reason: "invalid-value" };
  return { ok: true, value: parsed as ConfigValue };
}
