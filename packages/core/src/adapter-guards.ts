import type { ConfigPath } from "./types.js";

const ISSUE_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isIssueCode(value: unknown): value is string {
  return typeof value === "string" && ISSUE_CODE_PATTERN.test(value);
}

export function isConfigPath(value: unknown): value is ConfigPath {
  if (!Array.isArray(value)) return false;
  // for..of visits holes; Array.every would silently accept a sparse path.
  for (const segment of value) {
    if (typeof segment !== "string" &&
        !(typeof segment === "number" && Number.isSafeInteger(segment) && segment >= 0)) {
      return false;
    }
  }
  return true;
}
