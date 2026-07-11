import {
  createMappedOverrideSource,
  type ConfigIssue,
  type ConfigSourceDescriptor,
  type LoadedSource,
  type OverrideMapping
} from "@0disoft/universal-config-engine-core";
import { positiveSafeIntegerLimit } from "./limits.js";

export const DEFAULT_MAX_ENV_ENTRIES = 4096;

export interface CreateProcessEnvSourceInput {
  readonly descriptor: ConfigSourceDescriptor;
  readonly env: NodeJS.ProcessEnv;
  readonly mappings: readonly OverrideMapping[];
  readonly maxEnvEntries?: number;
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
