import {
  createMappedOverrideSource,
  type ConfigIssue,
  type ConfigSourceDescriptor,
  type LoadedSource,
  type OverrideMapping
} from "@0disoft/universal-config-engine-core";
import { positiveSafeIntegerLimit } from "./limits.js";
import { behaviorSeverity, type UnmappedInputBehavior } from "./input-policy.js";

export const DEFAULT_MAX_ENV_ENTRIES = 4096;

export interface CreateProcessEnvSourceInput {
  readonly descriptor: ConfigSourceDescriptor;
  readonly env: NodeJS.ProcessEnv;
  readonly mappings: readonly OverrideMapping[];
  readonly maxEnvEntries?: number;
  readonly unmappedBehavior?: UnmappedInputBehavior;
  readonly unmappedPrefix?: string;
}

export function createProcessEnvSource(input: CreateProcessEnvSourceInput): LoadedSource {
  const maxEnvEntries = positiveSafeIntegerLimit(input.maxEnvEntries, DEFAULT_MAX_ENV_ENTRIES);
  const envEntries = Object.keys(input.env).length;
  if (envEntries > maxEnvEntries) {
    return {
      descriptor: input.descriptor,
      value: {},
      issues: [
        {
          category: "resource-limit",
          code: "max_env_entries_exceeded",
          severity: "error",
          sourceId: input.descriptor.id,
          message: `Environment source exceeds the maximum of ${maxEnvEntries} entries.`,
          details: {
            envEntries,
            maxEnvEntries
          }
        }
      ]
    };
  }

  const values: Record<string, string> = {};
  const issues: ConfigIssue[] = [];
  if (
    input.unmappedBehavior !== undefined &&
    input.unmappedBehavior !== "warning" &&
    input.unmappedBehavior !== "error"
  ) {
    return unmappedPolicyFailure(input.descriptor, "unmapped_env_behavior_invalid", "Invalid unmappedBehavior.");
  }
  if (input.unmappedPrefix !== undefined && input.unmappedBehavior === undefined) {
    return unmappedPolicyFailure(
      input.descriptor,
      "unmapped_env_behavior_required",
      "unmappedPrefix requires unmappedBehavior."
    );
  }
  if (input.unmappedBehavior !== undefined && !isNonEmptyPrefix(input.unmappedPrefix)) {
    return unmappedPolicyFailure(
      input.descriptor,
      "unmapped_env_prefix_required",
      "Strict environment mapping requires a non-empty unmappedPrefix."
    );
  }

  if (input.unmappedBehavior !== undefined && input.unmappedPrefix !== undefined) {
    const mappedNames = new Set(
      input.mappings
        .filter((mapping) => mapping.sourceKind === "process-env")
        .map((mapping) => mapping.externalName)
    );
    for (const envName of Object.keys(input.env)) {
      if (envName.startsWith(input.unmappedPrefix) && !mappedNames.has(envName)) {
        issues.push({
          category: "mapping",
          code: "unmapped_env_entry",
          severity: behaviorSeverity(input.unmappedBehavior),
          sourceId: input.descriptor.id,
          message: "Environment input matched the strict prefix but has no declared mapping.",
          details: { externalName: envName }
        });
      }
    }
  }

  for (const mapping of input.mappings) {
    if (mapping.sourceKind !== "process-env") {
      continue;
    }

    const rawValue = input.env[mapping.externalName];
    if (rawValue === undefined) {
      continue;
    }

    values[mapping.externalName] = rawValue;
  }

  const mapped = createMappedOverrideSource({
    descriptor: input.descriptor,
    values,
    mappings: input.mappings
  });

  return {
    ...mapped,
    issues: [...issues, ...(mapped.issues ?? [])]
  };
}

function unmappedPolicyFailure(
  descriptor: ConfigSourceDescriptor,
  code: string,
  message: string
): LoadedSource {
  return {
    descriptor,
    value: {},
    issues: [{ category: "mapping", code, severity: "error", sourceId: descriptor.id, message }]
  };
}

function isNonEmptyPrefix(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}
