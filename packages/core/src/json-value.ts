import { isUnsafePathSegment } from "./path.js";
import { isConfigValue } from "./value.js";
import type { ConfigValue } from "./types.js";

type JsonValueResult =
  | { readonly ok: true; readonly value: ConfigValue }
  | { readonly ok: false; readonly reason: "invalid-json" | "invalid-value" | "unsafe-key" };

/** Shared JSON checks; callers own stage-specific issue codes and messages. */
export function parseJsonConfigValue(raw: string): JsonValueResult {
  try {
    let unsafeKey = false;
    const parsed: unknown = JSON.parse(raw, (key: string, child: unknown) => {
      if (isUnsafePathSegment(key)) unsafeKey = true;
      return child;
    });
    if (unsafeKey) return { ok: false, reason: "unsafe-key" };
    if (!isConfigValue(parsed)) return { ok: false, reason: "invalid-value" };
    return { ok: true, value: parsed };
  } catch {
    return { ok: false, reason: "invalid-json" };
  }
}
