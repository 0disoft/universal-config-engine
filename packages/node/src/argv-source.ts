import {
  createMappedOverrideSource,
  type ConfigIssue,
  type ConfigSourceDescriptor,
  type LoadedSource,
  type OverrideMapping
} from "@0disoft/universal-config-engine-core";
import { positiveSafeIntegerLimit } from "./limits.js";

export const DEFAULT_MAX_ARGV_ENTRIES = 4096;

export interface CreateArgvSourceInput {
  readonly descriptor: ConfigSourceDescriptor;
  readonly argv: readonly string[];
  readonly mappings: readonly OverrideMapping[];
  readonly maxArgvEntries?: number;
}

export function createArgvSource(input: CreateArgvSourceInput): LoadedSource {
  const maxArgvEntries = positiveSafeIntegerLimit(input.maxArgvEntries, DEFAULT_MAX_ARGV_ENTRIES);
  if (input.argv.length > maxArgvEntries) {
    return {
      descriptor: input.descriptor,
      value: {},
      issues: [
        {
          category: "resource-limit",
          code: "max_argv_entries_exceeded",
          severity: "error",
          sourceId: input.descriptor.id,
          message: `Argument source exceeds the maximum of ${maxArgvEntries} entries.`,
          details: {
            argvEntries: input.argv.length,
            maxArgvEntries
          }
        }
      ]
    };
  }

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

    if (parsed.status === "duplicate") {
      issues.push({
        category: "mapping",
        code: "argv_duplicate_argument",
        severity: "error",
        sourceId: input.descriptor.id,
        path: mapping.targetPath,
        message: `Argument ${mapping.externalName} must not be provided more than once.`
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
  | { readonly status: "invalid" }
  | { readonly status: "duplicate" } {
  let foundValue: string | undefined;
  let matchCount = 0;
  let hasInvalidMatch = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === externalName) {
      matchCount += 1;
      const next = argv[index + 1];
      if (next === undefined || !isArgValueToken(next)) {
        hasInvalidMatch = true;
        continue;
      }
      foundValue = next;
      continue;
    }

    const assignmentPrefix = `${externalName}=`;
    if (arg?.startsWith(assignmentPrefix) === true) {
      matchCount += 1;
      foundValue = arg.slice(assignmentPrefix.length);
    }
  }

  if (matchCount > 1) {
    return { status: "duplicate" };
  }

  if (hasInvalidMatch) {
    return { status: "invalid" };
  }

  if (foundValue !== undefined) {
    return { status: "found", value: foundValue };
  }

  return { status: "missing" };
}

function isArgValueToken(value: string): boolean {
  return !value.startsWith("-") || isNegativeNumberToken(value);
}

function isNegativeNumberToken(value: string): boolean {
  return /^-(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?$/i.test(value);
}
