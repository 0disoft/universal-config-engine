import type { ConfigPath, ResourceLimitPolicy } from "./types.js";

const ISSUE_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isIssueCode(value: unknown): value is string {
  return typeof value === "string" && ISSUE_CODE_PATTERN.test(value);
}

export function isConfigPath(
  value: unknown,
  limits?: Pick<ResourceLimitPolicy, "maxPathLength" | "maxReportBytes">
): value is ConfigPath {
  if (!Array.isArray(value) || (limits !== undefined && value.length > limits.maxPathLength)) return false;
  let characters = 0;
  // for..of visits holes; Array.every would silently accept a sparse path.
  for (const segment of value) {
    if (typeof segment === "string") characters += segment.length;
    if (limits !== undefined && characters > limits.maxReportBytes) return false;
    if (typeof segment !== "string" &&
        !(typeof segment === "number" && Number.isSafeInteger(segment) && segment >= 0)) {
      return false;
    }
  }
  return limits === undefined || new TextEncoder().encode(JSON.stringify(value)).byteLength <= limits.maxReportBytes;
}

export function isIssueDetails(value: unknown): value is Readonly<Record<string, string | number | boolean | null>> {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (detail) =>
        detail === null ||
        typeof detail === "string" ||
        typeof detail === "boolean" ||
        (typeof detail === "number" && Number.isFinite(detail))
    )
  );
}
