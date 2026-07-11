import type { ResourceLimitPolicy } from "./types.js";

export const DEFAULT_RESOURCE_LIMITS: ResourceLimitPolicy = {
  maxDepth: 32,
  maxKeyCount: 10_000,
  maxPathLength: 32,
  maxDiagnostics: 200
};

export function normalizeResourceLimits(
  input: Partial<ResourceLimitPolicy> | undefined
): ResourceLimitPolicy {
  return {
    maxDepth: positiveSafeIntegerOrDefault(input?.maxDepth, DEFAULT_RESOURCE_LIMITS.maxDepth),
    maxKeyCount: positiveSafeIntegerOrDefault(input?.maxKeyCount, DEFAULT_RESOURCE_LIMITS.maxKeyCount),
    maxPathLength: positiveSafeIntegerOrDefault(
      input?.maxPathLength,
      DEFAULT_RESOURCE_LIMITS.maxPathLength
    ),
    maxDiagnostics: positiveSafeIntegerOrDefault(
      input?.maxDiagnostics,
      DEFAULT_RESOURCE_LIMITS.maxDiagnostics
    )
  };
}

function positiveSafeIntegerOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
