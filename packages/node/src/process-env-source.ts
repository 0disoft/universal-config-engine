import {
  createMappedOverrideSource,
  type ConfigIssue,
  type ConfigSourceDescriptor,
  type LoadedSource,
  type OverrideMapping
} from "@0disoft/universal-config-engine-core";

export interface CreateProcessEnvSourceInput {
  readonly descriptor: ConfigSourceDescriptor;
  readonly env: NodeJS.ProcessEnv;
  readonly mappings: readonly OverrideMapping[];
}

export function createProcessEnvSource(input: CreateProcessEnvSourceInput): LoadedSource {
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
