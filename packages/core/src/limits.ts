import type { ResourceLimitPolicy } from "./types.js";

export const DEFAULT_RESOURCE_LIMITS: ResourceLimitPolicy = {
  maxDepth: 32,
  maxKeyCount: 10_000,
  maxPathLength: 32,
  maxDiagnostics: 200,
  maxSources: 64,
  maxProvenanceEvents: 20_000,
  maxResolvedPaths: 10_000,
  maxReportBytes: 4 * 1024 * 1024
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
    ),
    maxSources: positiveSafeIntegerOrDefault(input?.maxSources, DEFAULT_RESOURCE_LIMITS.maxSources),
    maxProvenanceEvents: positiveSafeIntegerOrDefault(
      input?.maxProvenanceEvents,
      DEFAULT_RESOURCE_LIMITS.maxProvenanceEvents
    ),
    maxResolvedPaths: positiveSafeIntegerOrDefault(
      input?.maxResolvedPaths,
      DEFAULT_RESOURCE_LIMITS.maxResolvedPaths
    ),
    maxReportBytes: minimumSafeIntegerOrDefault(
      input?.maxReportBytes,
      1024,
      DEFAULT_RESOURCE_LIMITS.maxReportBytes
    )
  };
}

function minimumSafeIntegerOrDefault(value: number | undefined, minimum: number, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum ? value : fallback;
}

function positiveSafeIntegerOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
