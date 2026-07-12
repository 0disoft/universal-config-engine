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

interface ArgObservation {
  matchCount: number;
  hasInvalidMatch: boolean;
  value?: string;
}

interface AssignmentPrefixNode {
  readonly children: Map<string, AssignmentPrefixNode>;
  readonly externalNames: string[];
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
  const observations = scanArgv(input.argv, input.mappings);

  for (const mapping of input.mappings) {
    if (mapping.sourceKind !== "argv") {
      continue;
    }

    const parsed = observationToArgValue(observations.get(mapping.externalName));
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

function observationToArgValue(observation: ArgObservation | undefined):
  | { readonly status: "found"; readonly value: string }
  | { readonly status: "missing" }
  | { readonly status: "invalid" }
  | { readonly status: "duplicate" } {
  if (observation === undefined || observation.matchCount === 0) {
    return { status: "missing" };
  }
  if (observation.matchCount > 1) {
    return { status: "duplicate" };
  }
  if (observation.hasInvalidMatch) {
    return { status: "invalid" };
  }
  if (observation.value !== undefined) {
    return { status: "found", value: observation.value };
  }
  return { status: "missing" };
}

function scanArgv(
  argv: readonly string[],
  mappings: readonly OverrideMapping[]
): ReadonlyMap<string, ArgObservation> {
  const exactNames = new Set<string>();
  const assignmentPrefixes = createAssignmentPrefixNode();
  for (const mapping of mappings) {
    if (mapping.sourceKind !== "argv") {
      continue;
    }
    exactNames.add(mapping.externalName);
    addAssignmentPrefix(assignmentPrefixes, mapping.externalName);
  }

  const observations = new Map<string, ArgObservation>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (exactNames.has(arg)) {
      const next = argv[index + 1];
      recordArgObservation(
        observations,
        arg,
        next !== undefined && isArgValueToken(next) ? next : undefined,
        next === undefined || !isArgValueToken(next)
      );
    }

    for (const match of matchAssignmentPrefixes(assignmentPrefixes, arg)) {
      recordArgObservation(observations, match.externalName, match.value, false);
    }
  }
  return observations;
}

function createAssignmentPrefixNode(): AssignmentPrefixNode {
  return { children: new Map(), externalNames: [] };
}

function addAssignmentPrefix(root: AssignmentPrefixNode, externalName: string): void {
  let node = root;
  for (const character of `${externalName}=`) {
    let child = node.children.get(character);
    if (child === undefined) {
      child = createAssignmentPrefixNode();
      node.children.set(character, child);
    }
    node = child;
  }
  if (!node.externalNames.includes(externalName)) {
    node.externalNames.push(externalName);
  }
}

function matchAssignmentPrefixes(
  root: AssignmentPrefixNode,
  arg: string
): readonly { readonly externalName: string; readonly value: string }[] {
  const matches: { externalName: string; value: string }[] = [];
  let node = root;
  for (let index = 0; index < arg.length; index += 1) {
    const child = node.children.get(arg[index]!);
    if (child === undefined) {
      break;
    }
    node = child;
    for (const externalName of node.externalNames) {
      matches.push({ externalName, value: arg.slice(index + 1) });
    }
  }
  return matches;
}

function recordArgObservation(
  observations: Map<string, ArgObservation>,
  externalName: string,
  value: string | undefined,
  invalid: boolean
): void {
  const observation = observations.get(externalName) ?? {
    matchCount: 0,
    hasInvalidMatch: false
  };
  observation.matchCount += 1;
  observation.hasInvalidMatch ||= invalid;
  if (value !== undefined) {
    observation.value = value;
  }
  observations.set(externalName, observation);
}

function isArgValueToken(value: string): boolean {
  return !value.startsWith("-") || isNegativeNumberToken(value);
}

function isNegativeNumberToken(value: string): boolean {
  return /^-(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?$/i.test(value);
}
