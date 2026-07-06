import {
  createMappedOverrideSource,
  type ConfigIssue,
  type ConfigSourceDescriptor,
  type LoadedSource,
  type OverrideMapping
} from "@universal-config-engine/core";

export interface CreateArgvSourceInput {
  readonly descriptor: ConfigSourceDescriptor;
  readonly argv: readonly string[];
  readonly mappings: readonly OverrideMapping[];
}

export function createArgvSource(input: CreateArgvSourceInput): LoadedSource {
  const values: Record<string, string> = {};
  const issues: ConfigIssue[] = [];

  for (const mapping of input.mappings) {
    if (mapping.sourceKind !== "argv") {
      continue;
    }

    const parsed = findArgValue(input.argv, mapping.externalName);
    if (parsed.status === "missing") {
      continue;
    }

    if (parsed.status === "invalid") {
      issues.push({
        category: "mapping",
        code: "argv_missing_value",
        severity: "error",
        sourceId: input.descriptor.id,
        path: mapping.targetPath,
        message: `Argument ${mapping.externalName} requires a value.`
      });
      continue;
    }

    values[mapping.externalName] = parsed.value;
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

function findArgValue(
  argv: readonly string[],
  externalName: string
):
  | { readonly status: "found"; readonly value: string }
  | { readonly status: "missing" }
  | { readonly status: "invalid" } {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === externalName) {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) {
        return { status: "invalid" };
      }
      return { status: "found", value: next };
    }

    const assignmentPrefix = `${externalName}=`;
    if (arg?.startsWith(assignmentPrefix) === true) {
      return { status: "found", value: arg.slice(assignmentPrefix.length) };
    }
  }

  return { status: "missing" };
}
