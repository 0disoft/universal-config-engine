import { isUnsafePathSegment, setConfigValueAtPath } from "./path.js";
import type {
  ConfigIssue,
  ConfigSourceDescriptor,
  ConfigValue,
  LoadedSource,
  OverrideMapping
} from "./types.js";

export interface CreateMappedOverrideSourceInput {
  readonly descriptor: ConfigSourceDescriptor;
  readonly values: Readonly<Record<string, string>>;
  readonly mappings: readonly OverrideMapping[];
}

interface MappingPathOwner {
  readonly externalName: string;
}

interface MappingPathNode {
  readonly children: Map<string, MappingPathNode>;
  terminal?: MappingPathOwner;
  firstTerminal?: MappingPathOwner;
}

export function createMappedOverrideSource(input: CreateMappedOverrideSourceInput): LoadedSource {
  const value: Record<string, ConfigValue> = {};
  const issues: ConfigIssue[] = [];
  const mappingPaths = createMappingPathNode();

  for (const mapping of input.mappings) {
    if (mapping.sourceKind !== input.descriptor.kind) {
      continue;
    }

    const rawValue = input.values[mapping.externalName];
    if (rawValue === undefined) {
      continue;
    }

    const pathConflict = addMappingPath(mappingPaths, mapping.targetPath, {
      externalName: mapping.externalName
    });
    if (pathConflict !== undefined) {
      const exact = pathConflict.kind === "exact";
      issues.push({
        category: "mapping",
        code: exact ? "duplicate_mapping_target_path" : "overlapping_mapping_target_path",
        severity: "error",
        sourceId: input.descriptor.id,
        path: mapping.targetPath,
        message: exact
          ? `Mapping ${mapping.externalName} targets the same path as ${pathConflict.owner.externalName}.`
          : `Mapping ${mapping.externalName} overlaps the target path of ${pathConflict.owner.externalName}.`
      });
      continue;
    }

    const unsafeSegment = mapping.targetPath.find((segment) => isUnsafePathSegment(segment));
    if (unsafeSegment !== undefined) {
      issues.push({
        category: "mapping",
        code: "unsafe_mapping_path",
        severity: "error",
        sourceId: input.descriptor.id,
        path: mapping.targetPath,
        message: `Mapping ${mapping.externalName} targets unsafe path segment ${String(unsafeSegment)}.`
      });
      continue;
    }

    const parsed = parseMappedValue(rawValue, mapping);
    if (!parsed.ok) {
      issues.push({
        category: "mapping",
        code: "mapping_parse_failed",
        severity: "error",
        sourceId: input.descriptor.id,
        path: mapping.targetPath,
        message: parsed.message
      });
      continue;
    }

    try {
      setConfigValueAtPath(value, mapping.targetPath, parsed.value);
    } catch {
      issues.push({
        category: "mapping",
        code: "mapping_set_failed",
        severity: "error",
        sourceId: input.descriptor.id,
        path: mapping.targetPath,
        message: "Failed to apply override mapping. Internal exception details were omitted from diagnostics."
      });
    }
  }

  return {
    descriptor: input.descriptor,
    value,
    issues
  };
}

function createMappingPathNode(): MappingPathNode {
  return { children: new Map() };
}

function addMappingPath(
  root: MappingPathNode,
  path: readonly (string | number)[],
  owner: MappingPathOwner
): { readonly kind: "exact" | "overlap"; readonly owner: MappingPathOwner } | undefined {
  const visited = [root];
  let node = root;

  for (const segment of path) {
    if (node.terminal !== undefined) {
      return { kind: "overlap", owner: node.terminal };
    }
    const segmentKey = JSON.stringify(segment);
    let child = node.children.get(segmentKey);
    if (child === undefined) {
      child = createMappingPathNode();
      node.children.set(segmentKey, child);
    }
    node = child;
    visited.push(node);
  }

  if (node.terminal !== undefined) {
    return { kind: "exact", owner: node.terminal };
  }
  if (node.firstTerminal !== undefined) {
    return { kind: "overlap", owner: node.firstTerminal };
  }

  node.terminal = owner;
  for (const visitedNode of visited) {
    visitedNode.firstTerminal ??= owner;
  }
  return undefined;
}

function parseMappedValue(
  rawValue: string,
  mapping: OverrideMapping
): { readonly ok: true; readonly value: ConfigValue } | { readonly ok: false; readonly message: string } {
  switch (mapping.parseAs ?? "string") {
    case "string":
      return { ok: true, value: rawValue };
    case "number": {
      const numericValue = Number(rawValue);
      if (!Number.isFinite(numericValue)) {
        return { ok: false, message: `Mapping ${mapping.externalName} expected a finite number.` };
      }
      return { ok: true, value: numericValue };
    }
    case "boolean": {
      if (rawValue === "true") {
        return { ok: true, value: true };
      }
      if (rawValue === "false") {
        return { ok: true, value: false };
      }
      return { ok: false, message: `Mapping ${mapping.externalName} expected true or false.` };
    }
    case "json":
      return parseJsonMappedValue(rawValue, mapping);
  }
}

function parseJsonMappedValue(
  rawValue: string,
  mapping: OverrideMapping
): { readonly ok: true; readonly value: ConfigValue } | { readonly ok: false; readonly message: string } {
  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (parsed === undefined || typeof parsed === "function" || typeof parsed === "symbol") {
      return { ok: false, message: `Mapping ${mapping.externalName} produced a non-config value.` };
    }
    return { ok: true, value: parsed as ConfigValue };
  } catch {
    return { ok: false, message: `Mapping ${mapping.externalName} expected valid JSON.` };
  }
}
