import type { ConfigPath, ConfigIssue } from "@0disoft/universal-config-engine-core";
import { DEFAULT_RESOURCE_LIMITS } from "@0disoft/universal-config-engine-core";
import { pipelineDeclarationIssue, appendDeclarationIssues } from "./declaration-diagnostics.js";
import {
  SUPPORTED_SOURCE_KINDS,
  SUPPORTED_FILE_FORMATS,
  SUPPORTED_MAPPING_PARSE_AS,
  SUPPORTED_COERCION_TARGETS,
  SUPPORTED_VALIDATOR_KINDS,
  RESOURCE_LIMIT_FIELDS,
  PIPELINE_DECLARATION_FIELDS,
  BASE_SOURCE_FIELDS,
  SOURCE_KIND_FIELDS,
  OVERRIDE_MAPPING_FIELDS,
  COERCION_RULE_FIELDS,
  VALIDATOR_DECLARATION_FIELDS,
  REDACTION_POLICY_FIELDS,
  formatConfigPath,
  isRecord,
  isPositiveInteger,
  isConfigPath,
  isStringOnlyConfigPath
} from "./declaration-fields.js";

export function validatePipelineDeclaration(value: unknown): readonly ConfigIssue[] {
  const issues: ConfigIssue[] = [];

  if (!isRecord(value)) {
    return [
      pipelineDeclarationIssue({
        code: "pipeline_declaration_invalid",
        message: "Pipeline declaration must be a JSON object."
      })
    ];
  }

  if (!appendDeclarationIssues(
    issues,
    validateAllowedFields(value, PIPELINE_DECLARATION_FIELDS, [], "pipeline_unknown_field")
  )) {
    return issues;
  }

  if (!Array.isArray(value.sources)) {
    issues.push(
      pipelineDeclarationIssue({
        code: "pipeline_sources_missing",
        path: ["sources"],
        message: "Pipeline declaration must contain a sources array."
      })
    );
    return issues;
  }

  for (const [index, source] of value.sources.entries()) {
    if (!appendDeclarationIssues(issues, validateSourceDeclaration(source, index))) {
      return issues;
    }
  }
  if (!appendDeclarationIssues(
    issues,
    validateUniqueDeclarationIds({
      entries: value.sources,
      collectionPath: "sources",
      duplicateCode: "pipeline_source_id_duplicate",
      duplicateMessage: "Pipeline source ids must be unique."
    })
  )) {
    return issues;
  }

  if (value.limits !== undefined) {
    if (!appendDeclarationIssues(issues, validateResourceLimitsDeclaration(value.limits))) {
      return issues;
    }
  }

  const declaredMaxSources = isRecord(value.limits) && isPositiveInteger(value.limits.maxSources)
    ? value.limits.maxSources
    : DEFAULT_RESOURCE_LIMITS.maxSources;
  if (value.sources.length > declaredMaxSources) {
    appendDeclarationIssues(issues, [{
      category: "resource-limit",
      code: "max_sources_exceeded",
      severity: "error",
      path: ["sources"],
      message: `Source count exceeded the maximum of ${declaredMaxSources}.`
    }]);
  }

  if (value.validators !== undefined && !Array.isArray(value.validators)) {
    issues.push(
      pipelineDeclarationIssue({
        code: "pipeline_validators_invalid",
        path: ["validators"],
        message: "Pipeline validators must be an array when provided."
      })
    );
  } else if (Array.isArray(value.validators)) {
    for (const [index, validator] of value.validators.entries()) {
      if (!appendDeclarationIssues(issues, validateValidatorDeclaration(validator, index))) {
        return issues;
      }
    }
    if (!appendDeclarationIssues(
      issues,
      validateUniqueDeclarationIds({
        entries: value.validators,
        collectionPath: "validators",
        duplicateCode: "pipeline_validator_id_duplicate",
        duplicateMessage: "Pipeline validator ids must be unique."
      })
    )) {
      return issues;
    }
    if (!appendDeclarationIssues(issues, validateDisjointDeclarationIds(value.sources, value.validators))) {
      return issues;
    }
  }

  if (value.coercionRules !== undefined && !Array.isArray(value.coercionRules)) {
    issues.push(
      pipelineDeclarationIssue({
        code: "pipeline_coercion_rules_invalid",
        path: ["coercionRules"],
        message: "Pipeline coercionRules must be an array when provided."
      })
    );
  } else if (Array.isArray(value.coercionRules)) {
    for (const [index, rule] of value.coercionRules.entries()) {
      if (!appendDeclarationIssues(issues, validateCoercionRuleDeclaration(rule, index))) {
        return issues;
      }
    }
  }

  return issues;
}

function validateSourceDeclaration(source: unknown, index: number): readonly ConfigIssue[] {
  const path: ConfigPath = ["sources", index];
  if (!isRecord(source)) {
    return [
      pipelineDeclarationIssue({
        code: "pipeline_source_invalid",
        path,
        message: "Pipeline source entries must be JSON objects."
      })
    ];
  }

  const issues: ConfigIssue[] = [];
  const sourceId = typeof source.id === "string" && source.id.length > 0 ? source.id : undefined;
  const sourcePath = (field: string): ConfigPath => [...path, field];
  const allowedSourceFields = typeof source.kind === "string" ? SOURCE_KIND_FIELDS[source.kind] : undefined;

  if (allowedSourceFields !== undefined) {
    issues.push(
      ...validateAllowedFields(
        source,
        unionAllowedFields(BASE_SOURCE_FIELDS, allowedSourceFields),
        path,
        "pipeline_source_unknown_field",
        sourceId
      )
    );
  }

  if (sourceId === undefined) {
    issues.push(
      pipelineDeclarationIssue({
        code: "pipeline_source_id_invalid",
        path: sourcePath("id"),
        message: "Pipeline source id must be a non-empty string."
      })
    );
  }

  if (typeof source.kind !== "string" || source.kind.length === 0) {
    issues.push(
      pipelineDeclarationIssue({
        code: "pipeline_source_kind_invalid",
        path: sourcePath("kind"),
        sourceId,
        message: "Pipeline source kind must be a non-empty string."
      })
    );
  } else if (!SUPPORTED_SOURCE_KINDS.has(source.kind)) {
    issues.push(
      pipelineDeclarationIssue({
        code: "unsupported_source_kind",
        path: sourcePath("kind"),
        sourceId,
        message: `Unsupported source kind ${source.kind}.`
      })
    );
  }

  if (source.redaction !== undefined) {
    issues.push(...validateRedactionPolicyDeclaration(source.redaction, sourcePath("redaction"), sourceId));
  }

  if (typeof source.priority !== "number" || !Number.isFinite(source.priority)) {
    issues.push(
      pipelineDeclarationIssue({
        code: "pipeline_source_priority_invalid",
        path: sourcePath("priority"),
        sourceId,
        message: "Pipeline source priority must be a finite number."
      })
    );
  }

  if (source.displayName !== undefined && (typeof source.displayName !== "string" || source.displayName.length === 0)) {
    issues.push(
      pipelineDeclarationIssue({
        code: "pipeline_source_display_name_invalid",
        path: sourcePath("displayName"),
        sourceId,
        message: "Pipeline source displayName must be a non-empty string when provided."
      })
    );
  }

  switch (source.kind) {
    case "object":
      if (!("value" in source)) {
        issues.push(
          pipelineDeclarationIssue({
            code: "pipeline_object_source_value_missing",
            path: sourcePath("value"),
            sourceId,
            message: "Object sources must include a value field."
          })
        );
      }
      break;
    case "json-file":
    case "dotenv-file":
    case "adapter":
      if (source.kind === "adapter") {
        if (typeof source.format !== "string" || !SUPPORTED_FILE_FORMATS.has(source.format)) {
          issues.push(pipelineDeclarationIssue({ code: "pipeline_file_format_invalid",
            path: sourcePath("format"), sourceId, message: "File adapters require a supported explicit format." }));
        }
        if (source.allowTrailingComma !== undefined &&
            (typeof source.allowTrailingComma !== "boolean" || source.format !== "jsonc")) {
          issues.push(pipelineDeclarationIssue({ code: "pipeline_file_trailing_comma_invalid",
            path: sourcePath("allowTrailingComma"), sourceId,
            message: "allowTrailingComma must be a boolean and is only supported for JSONC." }));
        }
      }
      if (typeof source.path !== "string" || source.path.length === 0) {
        issues.push(
          pipelineDeclarationIssue({
            code: "pipeline_file_source_path_invalid",
            path: sourcePath("path"),
            sourceId,
            message: "File sources must include a non-empty path string."
          })
        );
      }
      if (source.maxFileBytes !== undefined && !isPositiveInteger(source.maxFileBytes)) {
        issues.push(
          pipelineDeclarationIssue({
            code: "pipeline_file_source_max_file_bytes_invalid",
            path: sourcePath("maxFileBytes"),
            sourceId,
            message: "File source maxFileBytes must be a positive integer when provided."
          })
        );
      }
      break;
    case "process-env":
    case "argv":
      {
        const limitField = source.kind === "process-env" ? "maxEnvEntries" : "maxArgvEntries";
        if (source[limitField] !== undefined && !isPositiveInteger(source[limitField])) {
          issues.push(
            pipelineDeclarationIssue({
              code: source.kind === "process-env"
                ? "pipeline_process_env_max_entries_invalid"
                : "pipeline_argv_max_entries_invalid",
              path: sourcePath(limitField),
              sourceId,
              message: `${limitField} must be a positive integer when provided.`
            })
          );
        }
      }
      if (
        source.unmappedBehavior !== undefined &&
        source.unmappedBehavior !== "warning" &&
        source.unmappedBehavior !== "error"
      ) {
        issues.push(
          pipelineDeclarationIssue({
            code: "pipeline_unmapped_behavior_invalid",
            path: sourcePath("unmappedBehavior"),
            sourceId,
            message: "unmappedBehavior must be warning or error when provided."
          })
        );
      }
      if (source.kind === "process-env") {
        if (source.unmappedPrefix !== undefined && (
          typeof source.unmappedPrefix !== "string" || source.unmappedPrefix.length === 0
        )) {
          issues.push(
            pipelineDeclarationIssue({
              code: "pipeline_unmapped_prefix_invalid",
              path: sourcePath("unmappedPrefix"),
              sourceId,
              message: "Process env unmappedPrefix must be a non-empty string when provided."
            })
          );
        }
        if (
          (source.unmappedBehavior === "warning" || source.unmappedBehavior === "error") &&
          (typeof source.unmappedPrefix !== "string" || source.unmappedPrefix.length === 0)
        ) {
          issues.push(
            pipelineDeclarationIssue({
              code: "pipeline_unmapped_prefix_required",
              path: sourcePath("unmappedPrefix"),
              sourceId,
              message: "Strict process env mapping requires unmappedPrefix."
            })
          );
        }
        if (
          typeof source.unmappedPrefix === "string" &&
          source.unmappedPrefix.length > 0 &&
          source.unmappedBehavior === undefined
        ) {
          issues.push(
            pipelineDeclarationIssue({
              code: "pipeline_unmapped_behavior_required",
              path: sourcePath("unmappedBehavior"),
              sourceId,
              message: "Process env unmappedPrefix requires unmappedBehavior."
            })
          );
        }
      }
      if (!Array.isArray(source.mappings)) {
        issues.push(
          pipelineDeclarationIssue({
            code: "pipeline_override_mappings_invalid",
            path: sourcePath("mappings"),
            sourceId,
            message: "Override sources must include a mappings array."
          })
        );
      } else {
        for (const [mappingIndex, mapping] of source.mappings.entries()) {
          if (!appendDeclarationIssues(
            issues,
            validateOverrideMappingDeclaration(
              mapping,
              source.kind,
              [...sourcePath("mappings"), mappingIndex],
              sourceId
            )
          )) {
            return issues;
          }
        }
        appendDeclarationIssues(
          issues,
          validateUniqueMappingTargetPaths(source.mappings, sourcePath("mappings"), sourceId)
        );
      }
      break;
  }

  return issues;
}

function validateResourceLimitsDeclaration(limits: unknown): readonly ConfigIssue[] {
  const path: ConfigPath = ["limits"];
  if (!isRecord(limits)) {
    return [
      pipelineDeclarationIssue({
        code: "pipeline_limits_invalid",
        path,
        message: "Pipeline limits must be a JSON object when provided."
      })
    ];
  }

  const issues: ConfigIssue[] = [];
  issues.push(...validateAllowedFields(limits, new Set(RESOURCE_LIMIT_FIELDS), path, "pipeline_limits_unknown_field"));

  for (const field of RESOURCE_LIMIT_FIELDS) {
    if (limits[field] !== undefined && !isPositiveInteger(limits[field])) {
      issues.push(
        pipelineDeclarationIssue({
          code: "pipeline_limit_value_invalid",
          path: [...path, field],
          message: `Pipeline limits.${field} must be a positive integer when provided.`
        })
      );
    }
  }

  if (
    typeof limits.maxReportBytes === "number" &&
    isPositiveInteger(limits.maxReportBytes) &&
    limits.maxReportBytes < 1024
  ) {
    issues.push(
      pipelineDeclarationIssue({
        code: "pipeline_limit_value_invalid",
        path: [...path, "maxReportBytes"],
        message: "Pipeline limits.maxReportBytes must be at least 1024 when provided."
      })
    );
  }

  return issues;
}

function validateOverrideMappingDeclaration(
  mapping: unknown,
  expectedSourceKind: "process-env" | "argv",
  path: ConfigPath,
  sourceId: string | undefined
): readonly ConfigIssue[] {
  if (!isRecord(mapping)) {
    return [
      pipelineDeclarationIssue({
        code: "pipeline_override_mapping_invalid",
        path,
        sourceId,
        message: "Override mappings must be JSON objects."
      })
    ];
  }

  const issues: ConfigIssue[] = [];
  const fieldPath = (field: string): ConfigPath => [...path, field];
  issues.push(
    ...validateAllowedFields(
      mapping,
      OVERRIDE_MAPPING_FIELDS,
      path,
      "pipeline_override_mapping_unknown_field",
      sourceId
    )
  );

  if (typeof mapping.externalName !== "string" || mapping.externalName.length === 0) {
    issues.push(
      pipelineDeclarationIssue({
        code: "pipeline_override_mapping_external_name_invalid",
        path: fieldPath("externalName"),
        sourceId,
        message: "Override mapping externalName must be a non-empty string."
      })
    );
  }

  if (mapping.sourceKind !== expectedSourceKind) {
    issues.push(
      pipelineDeclarationIssue({
        code: "pipeline_override_mapping_source_kind_invalid",
        path: fieldPath("sourceKind"),
        sourceId,
        message: `Override mapping sourceKind must be ${expectedSourceKind}.`
      })
    );
  }

  if (!isStringOnlyConfigPath(mapping.targetPath)) {
    issues.push(
      pipelineDeclarationIssue({
        code: "pipeline_override_mapping_target_path_invalid",
        path: fieldPath("targetPath"),
        sourceId,
        message: "Override mapping targetPath must be a non-empty path array of strings."
      })
    );
  }

  if (mapping.parseAs !== undefined && (typeof mapping.parseAs !== "string" || !SUPPORTED_MAPPING_PARSE_AS.has(mapping.parseAs))) {
    issues.push(
      pipelineDeclarationIssue({
        code: "pipeline_override_mapping_parse_as_invalid",
        path: fieldPath("parseAs"),
        sourceId,
        message: "Override mapping parseAs must be string, number, boolean, or json."
      })
    );
  }

  if (mapping.secret !== undefined && typeof mapping.secret !== "boolean") {
    issues.push(
      pipelineDeclarationIssue({
        code: "pipeline_override_mapping_secret_invalid",
        path: fieldPath("secret"),
        sourceId,
        message: "Override mapping secret must be a boolean when provided."
      })
    );
  }

  return issues;
}

function validateCoercionRuleDeclaration(rule: unknown, index: number): readonly ConfigIssue[] {
  const path: ConfigPath = ["coercionRules", index];
  if (!isRecord(rule)) {
    return [
      pipelineDeclarationIssue({
        code: "pipeline_coercion_rule_invalid",
        path,
        message: "Coercion rules must be JSON objects."
      })
    ];
  }

  const issues: ConfigIssue[] = [];
  const fieldPath = (field: string): ConfigPath => [...path, field];
  issues.push(...validateAllowedFields(rule, COERCION_RULE_FIELDS, path, "pipeline_coercion_rule_unknown_field"));

  if (!isStringOnlyConfigPath(rule.path)) {
    issues.push(
      pipelineDeclarationIssue({
        code: "pipeline_coercion_rule_path_invalid",
        path: fieldPath("path"),
        message: "Coercion rule path must be a non-empty path array of strings."
      })
    );
  }

  if (rule.from !== "string") {
    issues.push(
      pipelineDeclarationIssue({
        code: "pipeline_coercion_rule_from_invalid",
        path: fieldPath("from"),
        message: "Coercion rule from must be string."
      })
    );
  }

  if (typeof rule.to !== "string" || !SUPPORTED_COERCION_TARGETS.has(rule.to)) {
    issues.push(
      pipelineDeclarationIssue({
        code: "pipeline_coercion_rule_to_invalid",
        path: fieldPath("to"),
        message: "Coercion rule to must be number, boolean, or json."
      })
    );
  }

  if (rule.onFailure !== "issue") {
    issues.push(
      pipelineDeclarationIssue({
        code: "pipeline_coercion_rule_on_failure_invalid",
        path: fieldPath("onFailure"),
        message: "Coercion rule onFailure must be issue."
      })
    );
  }

  return issues;
}

function validateValidatorDeclaration(validator: unknown, index: number): readonly ConfigIssue[] {
  const path: ConfigPath = ["validators", index];
  if (!isRecord(validator)) {
    return [
      pipelineDeclarationIssue({
        code: "pipeline_validator_invalid",
        path,
        message: "Validator declarations must be JSON objects."
      })
    ];
  }

  const issues: ConfigIssue[] = [];
  const validatorId = typeof validator.id === "string" && validator.id.length > 0 ? validator.id : undefined;
  const fieldPath = (field: string): ConfigPath => [...path, field];
  issues.push(
    ...validateAllowedFields(
      validator,
      VALIDATOR_DECLARATION_FIELDS,
      path,
      "pipeline_validator_unknown_field",
      validatorId
    )
  );

  if (validatorId === undefined) {
    issues.push(
      pipelineDeclarationIssue({
        code: "pipeline_validator_id_invalid",
        path: fieldPath("id"),
        message: "Validator id must be a non-empty string."
      })
    );
  }

  if (typeof validator.kind !== "string" || !SUPPORTED_VALIDATOR_KINDS.has(validator.kind)) {
    issues.push(
      pipelineDeclarationIssue({
        code: "pipeline_validator_kind_invalid",
        path: fieldPath("kind"),
        sourceId: validatorId,
        message: "Validator kind must be json-schema-ajv."
      })
    );
  }

  if (!(typeof validator.schema === "boolean" || isRecord(validator.schema))) {
    issues.push(
      pipelineDeclarationIssue({
        code: "pipeline_validator_schema_invalid",
        path: fieldPath("schema"),
        sourceId: validatorId,
        message: "Validator schema must be a JSON Schema object or boolean schema."
      })
    );
  }

  return issues;
}

function validateRedactionPolicyDeclaration(
  redaction: unknown,
  path: ConfigPath,
  sourceId: string | undefined
): readonly ConfigIssue[] {
  if (!isRecord(redaction)) {
    return [
      pipelineDeclarationIssue({
        code: "pipeline_redaction_policy_invalid",
        path,
        sourceId,
        message: "Source redaction must be a JSON object when provided."
      })
    ];
  }

  const issues: ConfigIssue[] = [
    ...validateAllowedFields(redaction, REDACTION_POLICY_FIELDS, path, "pipeline_redaction_policy_unknown_field", sourceId)
  ];
  const fieldPath = (field: string): ConfigPath => [...path, field];

  if (redaction.secretSource !== undefined && typeof redaction.secretSource !== "boolean") {
    issues.push(
      pipelineDeclarationIssue({
        code: "pipeline_redaction_secret_source_invalid",
        path: fieldPath("secretSource"),
        sourceId,
        message: "Source redaction secretSource must be a boolean when provided."
      })
    );
  }

  if (
    redaction.secretPaths !== undefined &&
    (!Array.isArray(redaction.secretPaths) || !redaction.secretPaths.every(isConfigPath))
  ) {
    issues.push(
      pipelineDeclarationIssue({
        code: "pipeline_redaction_secret_paths_invalid",
        path: fieldPath("secretPaths"),
        sourceId,
        message: "Source redaction secretPaths must be an array of non-empty path arrays."
      })
    );
  }

  if (
    redaction.secretNamePatterns !== undefined &&
    (!Array.isArray(redaction.secretNamePatterns) ||
      !redaction.secretNamePatterns.every((pattern) => typeof pattern === "string" && pattern.length > 0))
  ) {
    issues.push(
      pipelineDeclarationIssue({
        code: "pipeline_redaction_secret_name_patterns_invalid",
        path: fieldPath("secretNamePatterns"),
        sourceId,
        message: "Source redaction secretNamePatterns must be an array of non-empty strings."
      })
    );
  }

  return issues;
}

function validateAllowedFields(
  value: Readonly<Record<string, unknown>>,
  allowedFields: ReadonlySet<string>,
  path: ConfigPath,
  code: string,
  sourceId?: string | undefined
): readonly ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  for (const field of Object.keys(value)) {
    if (allowedFields.has(field)) {
      continue;
    }
    if (!appendDeclarationIssues(
      issues,
      [pipelineDeclarationIssue({
        code,
        path: [...path, field],
        sourceId,
        message: `Unknown pipeline declaration field ${formatConfigPath([...path, field])}.`
      })]
    )) {
      break;
    }
  }
  return issues;
}

function validateUniqueDeclarationIds(input: {
  readonly entries: readonly unknown[];
  readonly collectionPath: string;
  readonly duplicateCode: string;
  readonly duplicateMessage: string;
}): readonly ConfigIssue[] {
  const firstIndexById = new Map<string, number>();
  const issues: ConfigIssue[] = [];

  for (const [index, entry] of input.entries.entries()) {
    if (!isRecord(entry) || typeof entry.id !== "string" || entry.id.length === 0) {
      continue;
    }

    const firstIndex = firstIndexById.get(entry.id);
    if (firstIndex === undefined) {
      firstIndexById.set(entry.id, index);
      continue;
    }

    if (!appendDeclarationIssues(
      issues,
      [pipelineDeclarationIssue({
        code: input.duplicateCode,
        path: [input.collectionPath, index, "id"],
        sourceId: entry.id,
        message: `${input.duplicateMessage} Duplicate id ${entry.id} was first declared at ${input.collectionPath}.${firstIndex}.id.`
      })]
    )) {
      break;
    }
  }

  return issues;
}

function validateDisjointDeclarationIds(
  sources: readonly unknown[],
  validators: readonly unknown[]
): readonly ConfigIssue[] {
  const sourceIndexById = new Map<string, number>();
  const issues: ConfigIssue[] = [];

  for (const [index, source] of sources.entries()) {
    if (!isRecord(source) || typeof source.id !== "string" || source.id.length === 0) {
      continue;
    }

    if (!sourceIndexById.has(source.id)) {
      sourceIndexById.set(source.id, index);
    }
  }

  for (const [index, validator] of validators.entries()) {
    if (!isRecord(validator) || typeof validator.id !== "string" || validator.id.length === 0) {
      continue;
    }

    const sourceIndex = sourceIndexById.get(validator.id);
    if (sourceIndex === undefined) {
      continue;
    }

    if (!appendDeclarationIssues(
      issues,
      [pipelineDeclarationIssue({
        code: "pipeline_declaration_id_namespace_collision",
        path: ["validators", index, "id"],
        sourceId: validator.id,
        message: `Pipeline validator id ${validator.id} conflicts with source id declared at sources.${sourceIndex}.id.`
      })]
    )) {
      break;
    }
  }

  return issues;
}

function validateUniqueMappingTargetPaths(
  mappings: readonly unknown[],
  path: ConfigPath,
  sourceId: string | undefined
): readonly ConfigIssue[] {
  const mappingPaths = createDeclarationPathNode();
  const issues: ConfigIssue[] = [];

  for (const [index, mapping] of mappings.entries()) {
    if (!isRecord(mapping) || !isStringOnlyConfigPath(mapping.targetPath)) {
      continue;
    }

    const targetPath = mapping.targetPath;
    const conflict = addDeclarationPath(mappingPaths, targetPath, index);
    if (conflict === undefined) {
      continue;
    }

    const exact = conflict.kind === "exact";
    if (!appendDeclarationIssues(
      issues,
      [pipelineDeclarationIssue({
        code: exact
          ? "pipeline_override_mapping_target_path_duplicate"
          : "pipeline_override_mapping_target_path_overlap",
        path: [...path, index, "targetPath"],
        sourceId,
        message: exact
          ? `Override mapping targetPath duplicates mappings.${conflict.index}.targetPath.`
          : `Override mapping targetPath overlaps mappings.${conflict.index}.targetPath.`
      })]
    )) {
      break;
    }
  }

  return issues;
}

interface DeclarationPathNode {
  readonly children: Map<string, DeclarationPathNode>;
  terminalIndex?: number;
  firstTerminalIndex?: number;
}

function createDeclarationPathNode(): DeclarationPathNode {
  return { children: new Map() };
}

function addDeclarationPath(
  root: DeclarationPathNode,
  path: ConfigPath,
  index: number
): { readonly kind: "exact" | "overlap"; readonly index: number } | undefined {
  const visited = [root];
  let node = root;

  for (const segment of path) {
    if (node.terminalIndex !== undefined) {
      return { kind: "overlap", index: node.terminalIndex };
    }
    const segmentKey = JSON.stringify(segment);
    let child = node.children.get(segmentKey);
    if (child === undefined) {
      child = createDeclarationPathNode();
      node.children.set(segmentKey, child);
    }
    node = child;
    visited.push(node);
  }

  if (node.terminalIndex !== undefined) {
    return { kind: "exact", index: node.terminalIndex };
  }
  if (node.firstTerminalIndex !== undefined) {
    return { kind: "overlap", index: node.firstTerminalIndex };
  }

  node.terminalIndex = index;
  for (const visitedNode of visited) {
    visitedNode.firstTerminalIndex ??= index;
  }
  return undefined;
}

function unionAllowedFields(left: ReadonlySet<string>, right: ReadonlySet<string>): ReadonlySet<string> {
  return new Set([...left, ...right]);
}
