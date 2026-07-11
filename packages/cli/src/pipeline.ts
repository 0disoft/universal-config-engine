import { realpath } from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep
} from "node:path";
import {
  createArgvSource,
  createProcessEnvSource,
  DEFAULT_MAX_FILE_BYTES,
  loadDotenvFileSource,
  loadJsonFileSource,
  readTextFileWithinLimit
} from "@0disoft/universal-config-engine-node";
import type {
  CoercionRule,
  ConfigPath,
  ConfigIssue,
  ConfigSourceDescriptor,
  LoadedSource,
  OverrideMapping,
  RedactionPolicyInput,
  ResourceLimitPolicy,
  SourceKind
} from "@0disoft/universal-config-engine-core";
import { pathsEqual } from "@0disoft/universal-config-engine-core";
import type {
  PipelineDeclaration,
  PipelineValidatorDeclaration,
  PipelineSourceDeclaration
} from "./types.js";

const SUPPORTED_SOURCE_KINDS = new Set(["object", "json-file", "dotenv-file", "process-env", "argv"]);
const SUPPORTED_MAPPING_PARSE_AS = new Set(["string", "number", "boolean", "json"]);
const SUPPORTED_COERCION_TARGETS = new Set(["number", "boolean", "json"]);
const SUPPORTED_VALIDATOR_KINDS = new Set(["json-schema-ajv"]);
const RESOURCE_LIMIT_FIELDS = ["maxDepth", "maxKeyCount", "maxPathLength", "maxDiagnostics"] as const;
const PIPELINE_DECLARATION_FIELDS = new Set(["sources", "validators", "coercionRules", "limits"]);
const BASE_SOURCE_FIELDS = new Set(["id", "kind", "priority", "displayName", "redaction"]);
const SOURCE_KIND_FIELDS: Readonly<Record<string, ReadonlySet<string>>> = {
  object: new Set(["value"]),
  "json-file": new Set(["path", "maxFileBytes"]),
  "dotenv-file": new Set(["path", "maxFileBytes"]),
  "process-env": new Set(["mappings", "maxEnvEntries"]),
  argv: new Set(["mappings", "maxArgvEntries"])
};
const OVERRIDE_MAPPING_FIELDS = new Set(["externalName", "targetPath", "sourceKind", "parseAs", "secret"]);
const COERCION_RULE_FIELDS = new Set(["path", "from", "to", "onFailure"]);
const VALIDATOR_DECLARATION_FIELDS = new Set(["id", "kind", "schema"]);
const REDACTION_POLICY_FIELDS = new Set(["secretSource", "secretPaths", "secretNamePatterns"]);

export class PipelineDeclarationError extends Error {
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    super("Pipeline declaration is invalid.");
    this.name = "PipelineDeclarationError";
    this.issues = issues;
  }
}

export async function loadPipelineDeclaration(configPath: string, cwd = process.cwd()): Promise<PipelineDeclaration> {
  const readResult = await readTextFileWithinLimit({
    filePath: resolveInputPath(configPath, cwd),
    sourceId: "cli:pipeline-declaration",
    maxFileBytes: DEFAULT_MAX_FILE_BYTES
  });
  if (!readResult.ok) {
    throw new PipelineDeclarationError(readResult.issues);
  }

  const parsed = JSON.parse(readResult.raw) as unknown;
  const issues = validatePipelineDeclaration(parsed);

  if (issues.length > 0) {
    throw new PipelineDeclarationError(issues);
  }

  return normalizePipelineDeclaration(parsed);
}

export async function loadDeclaredSources(input: {
  readonly declaration: PipelineDeclaration;
  readonly configPath: string;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly argv: readonly string[];
}): Promise<readonly LoadedSource[]> {
  const sources: LoadedSource[] = [];

  for (const [index, source] of input.declaration.sources.entries()) {
    const descriptor = createDescriptor(source);

    switch (source.kind) {
      case "object":
        sources.push({
          descriptor,
          value: source.value
        });
        break;
      case "json-file":
        {
          const filePath = await resolveConfigRelativePath({
            configPath: input.configPath,
            cwd: input.cwd,
            sourceIndex: index,
            sourceId: descriptor.id,
            targetPath: source.path
          });
          sources.push(
            filePath.ok
              ? await loadJsonFileSource(
                  source.maxFileBytes === undefined
                    ? {
                        descriptor,
                        filePath: filePath.path,
                        allowedRootPath: filePath.allowedRootPath
                      }
                    : {
                        descriptor,
                        filePath: filePath.path,
                        allowedRootPath: filePath.allowedRootPath,
                        maxFileBytes: source.maxFileBytes
                      }
                )
              : failedDeclaredSource(descriptor, filePath.issue)
          );
        }
        break;
      case "dotenv-file":
        {
          const filePath = await resolveConfigRelativePath({
            configPath: input.configPath,
            cwd: input.cwd,
            sourceIndex: index,
            sourceId: descriptor.id,
            targetPath: source.path
          });
          sources.push(
            filePath.ok
              ? await loadDotenvFileSource(
                  source.maxFileBytes === undefined
                    ? {
                        descriptor,
                        filePath: filePath.path,
                        allowedRootPath: filePath.allowedRootPath
                      }
                    : {
                        descriptor,
                        filePath: filePath.path,
                        allowedRootPath: filePath.allowedRootPath,
                        maxFileBytes: source.maxFileBytes
                      }
                )
              : failedDeclaredSource(descriptor, filePath.issue)
          );
        }
        break;
      case "process-env":
        sources.push(
          createProcessEnvSource({
            descriptor,
            env: input.env,
            mappings: source.mappings,
            ...(source.maxEnvEntries === undefined ? {} : { maxEnvEntries: source.maxEnvEntries })
          })
        );
        break;
      case "argv":
        sources.push(
          createArgvSource({
            descriptor,
            argv: input.argv,
            mappings: source.mappings,
            ...(source.maxArgvEntries === undefined ? {} : { maxArgvEntries: source.maxArgvEntries })
          })
        );
        break;
      default:
        sources.push({
          descriptor,
          value: {},
          issues: [
            {
              category: "source-load",
              code: "unsupported_source_kind",
              severity: "error",
              sourceId: descriptor.id,
              message: `Unsupported source kind ${(source as { readonly kind: string }).kind}.`
            }
          ]
        });
        break;
    }
  }

  return sources;
}

function failedDeclaredSource(descriptor: ConfigSourceDescriptor, issue: ConfigIssue): LoadedSource {
  return {
    descriptor,
    value: {},
    issues: [issue]
  };
}

function normalizePipelineDeclaration(value: unknown): PipelineDeclaration {
  if (!isRecord(value) || !Array.isArray(value.sources)) {
    throw new PipelineDeclarationError([
      pipelineDeclarationIssue({
        code: "pipeline_declaration_invalid",
        message: "Pipeline declaration must be a JSON object."
      })
    ]);
  }

  return {
    sources: value.sources.map((source) => normalizeSourceDeclaration(source)),
    ...(Array.isArray(value.validators)
      ? { validators: value.validators.map((validator) => normalizeValidatorDeclaration(validator)) }
      : {}),
    ...(Array.isArray(value.coercionRules)
      ? { coercionRules: value.coercionRules.map((rule) => normalizeCoercionRuleDeclaration(rule)) }
      : {}),
    ...(isRecord(value.limits) ? { limits: normalizeResourceLimitsDeclaration(value.limits) } : {})
  };
}

function normalizeSourceDeclaration(source: unknown): PipelineSourceDeclaration {
  if (!isRecord(source) || typeof source.kind !== "string") {
    throw new Error("Invalid source declaration reached normalization.");
  }

  const base = normalizeBaseSourceDeclaration(source);

  switch (source.kind) {
    case "object":
      return {
        ...base,
        kind: "object",
        value: source.value
      };
    case "json-file":
      return {
        ...base,
        kind: "json-file",
        path: stringField(source, "path"),
        ...optionalPositiveIntegerField(source, "maxFileBytes")
      };
    case "dotenv-file":
      return {
        ...base,
        kind: "dotenv-file",
        path: stringField(source, "path"),
        ...optionalPositiveIntegerField(source, "maxFileBytes")
      };
    case "process-env":
      return {
        ...base,
        kind: "process-env",
        mappings: arrayField(source, "mappings").map((mapping) => normalizeOverrideMapping(mapping, "process-env")),
        ...optionalPositiveIntegerField(source, "maxEnvEntries")
      };
    case "argv":
      return {
        ...base,
        kind: "argv",
        mappings: arrayField(source, "mappings").map((mapping) => normalizeOverrideMapping(mapping, "argv")),
        ...optionalPositiveIntegerField(source, "maxArgvEntries")
      };
    default:
      throw new Error(`Unsupported source kind ${source.kind} reached normalization.`);
  }
}

function normalizeBaseSourceDeclaration(source: Readonly<Record<string, unknown>>): {
  readonly id: string;
  readonly priority: number;
  readonly displayName?: string;
  readonly redaction?: RedactionPolicyInput;
} {
  return {
    id: stringField(source, "id"),
    priority: numberField(source, "priority"),
    ...optionalStringField(source, "displayName"),
    ...(isRecord(source.redaction) ? { redaction: normalizeRedactionPolicyDeclaration(source.redaction) } : {})
  };
}

function normalizeOverrideMapping(mapping: unknown, sourceKind: "process-env" | "argv"): OverrideMapping {
  if (!isRecord(mapping)) {
    throw new Error("Invalid override mapping reached normalization.");
  }

  return {
    externalName: stringField(mapping, "externalName"),
    sourceKind,
    targetPath: stringPathField(mapping, "targetPath"),
    ...optionalParseAsField(mapping),
    ...optionalBooleanField(mapping, "secret")
  };
}

function normalizeCoercionRuleDeclaration(rule: unknown): CoercionRule {
  if (!isRecord(rule)) {
    throw new Error("Invalid coercion rule reached normalization.");
  }

  return {
    path: stringPathField(rule, "path"),
    from: "string",
    to: coercionTargetField(rule, "to"),
    onFailure: "issue"
  };
}

function normalizeValidatorDeclaration(validator: unknown): PipelineValidatorDeclaration {
  if (!isRecord(validator)) {
    throw new Error("Invalid validator declaration reached normalization.");
  }

  return {
    id: stringField(validator, "id"),
    kind: "json-schema-ajv",
    schema: validator.schema
  };
}

function normalizeResourceLimitsDeclaration(limits: Readonly<Record<string, unknown>>): Partial<ResourceLimitPolicy> {
  return {
    ...optionalPositiveIntegerField(limits, "maxDepth"),
    ...optionalPositiveIntegerField(limits, "maxKeyCount"),
    ...optionalPositiveIntegerField(limits, "maxPathLength"),
    ...optionalPositiveIntegerField(limits, "maxDiagnostics")
  };
}

function normalizeRedactionPolicyDeclaration(redaction: Readonly<Record<string, unknown>>): RedactionPolicyInput {
  return {
    ...optionalBooleanField(redaction, "secretSource"),
    ...(Array.isArray(redaction.secretPaths)
      ? { secretPaths: redaction.secretPaths.map((path) => normalizeConfigPath(path)) }
      : {}),
    ...(Array.isArray(redaction.secretNamePatterns)
      ? { secretNamePatterns: redaction.secretNamePatterns.map((pattern) => stringValue(pattern)) }
      : {})
  };
}

function stringField(record: Readonly<Record<string, unknown>>, field: string): string {
  return stringValue(record[field]);
}

function stringValue(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Expected normalized string field.");
  }

  return value;
}

function numberField(record: Readonly<Record<string, unknown>>, field: string): number {
  const value = record[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("Expected normalized finite number field.");
  }

  return value;
}

function arrayField(record: Readonly<Record<string, unknown>>, field: string): readonly unknown[] {
  const value = record[field];
  if (!Array.isArray(value)) {
    throw new Error("Expected normalized array field.");
  }

  return value;
}

function optionalStringField(
  record: Readonly<Record<string, unknown>>,
  field: string
): { readonly [key: string]: string } {
  const value = record[field];
  return value === undefined ? {} : { [field]: stringValue(value) };
}

function optionalBooleanField(
  record: Readonly<Record<string, unknown>>,
  field: string
): { readonly [key: string]: boolean } {
  const value = record[field];
  if (value === undefined) {
    return {};
  }

  if (typeof value !== "boolean") {
    throw new Error("Expected normalized boolean field.");
  }

  return { [field]: value };
}

function optionalPositiveIntegerField(
  record: Readonly<Record<string, unknown>>,
  field: string
): { readonly [key: string]: number } {
  const value = record[field];
  if (value === undefined) {
    return {};
  }

  if (!isPositiveInteger(value)) {
    throw new Error("Expected normalized positive integer field.");
  }

  return { [field]: value };
}

function optionalParseAsField(record: Readonly<Record<string, unknown>>): Pick<OverrideMapping, "parseAs"> {
  const value = record.parseAs;
  if (value === undefined) {
    return {};
  }

  if (value !== "string" && value !== "number" && value !== "boolean" && value !== "json") {
    throw new Error("Expected normalized parseAs field.");
  }

  return { parseAs: value };
}

function coercionTargetField(
  record: Readonly<Record<string, unknown>>,
  field: string
): CoercionRule["to"] {
  const value = record[field];
  if (value !== "number" && value !== "boolean" && value !== "json") {
    throw new Error("Expected normalized coercion target field.");
  }

  return value;
}

function stringPathField(record: Readonly<Record<string, unknown>>, field: string): ConfigPath {
  return normalizeStringPath(record[field]);
}

function normalizeStringPath(value: unknown): ConfigPath {
  if (!Array.isArray(value) || !value.every((segment) => typeof segment === "string")) {
    throw new Error("Expected normalized string path.");
  }

  return value.map((segment) => segment);
}

function normalizeConfigPath(value: unknown): ConfigPath {
  if (
    !Array.isArray(value) ||
    !value.every((segment) => typeof segment === "string" || typeof segment === "number")
  ) {
    throw new Error("Expected normalized config path.");
  }

  return value.map((segment) => segment);
}

function createDescriptor(source: PipelineSourceDeclaration): ConfigSourceDescriptor {
  const redaction = mergeSourceRedactionWithSecretMappings(source);
  const base = {
    id: source.id,
    kind: source.kind as SourceKind,
    priority: source.priority,
    displayName: source.displayName ?? source.id
  };

  return redaction === undefined
    ? base
    : {
        ...base,
        redaction
      };
}

function mergeSourceRedactionWithSecretMappings(source: PipelineSourceDeclaration): RedactionPolicyInput | undefined {
  const declaredRedaction = source.redaction as RedactionPolicyInput | undefined;
  const secretMappingPaths =
    "mappings" in source && Array.isArray(source.mappings)
      ? source.mappings
          .filter((mapping) => mapping.secret === true)
          .map((mapping) => mapping.targetPath)
      : [];

  if (declaredRedaction === undefined && secretMappingPaths.length === 0) {
    return undefined;
  }

  const secretPaths: ConfigPath[] = [];
  for (const path of [...(declaredRedaction?.secretPaths ?? []), ...secretMappingPaths]) {
    if (!secretPaths.some((existing) => pathsEqual(existing, path))) {
      secretPaths.push(path);
    }
  }

  return {
    ...(declaredRedaction ?? {}),
    ...(secretPaths.length === 0 ? {} : { secretPaths })
  };
}

async function resolveConfigRelativePath(input: {
  readonly configPath: string;
  readonly cwd: string;
  readonly sourceIndex: number;
  readonly sourceId: string;
  readonly targetPath: string;
}): Promise<
  | { readonly ok: true; readonly path: string; readonly allowedRootPath: string }
  | { readonly ok: false; readonly issue: ConfigIssue }
> {
  const absoluteConfigPath = resolveInputPath(input.configPath, input.cwd);
  const canonicalConfigPath = await canonicalizeExistingPath(absoluteConfigPath);
  const configDirectory = dirname(canonicalConfigPath);
  const resolvedTargetPath = input.targetPath === ""
    ? configDirectory
    : isAbsolute(input.targetPath)
      ? resolve(input.targetPath)
      : resolve(configDirectory, input.targetPath);

  const canonicalTargetPath = await canonicalizeExistingPath(resolvedTargetPath);
  if (!isInsideOrEqualPath(configDirectory, canonicalTargetPath)) {
    return outsideConfigDirectoryResult(input);
  }

  return {
    ok: true,
    path: canonicalTargetPath,
    allowedRootPath: configDirectory
  };
}

async function canonicalizeExistingPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

function outsideConfigDirectoryResult(input: {
  readonly sourceIndex: number;
  readonly sourceId: string;
}): { readonly ok: false; readonly issue: ConfigIssue } {
  return {
    ok: false,
    issue: pipelineDeclarationIssue({
      code: "pipeline_file_source_path_outside_config_directory",
      path: ["sources", input.sourceIndex, "path"],
      sourceId: input.sourceId,
      message: "File source paths must stay within the pipeline declaration directory."
    })
  };
}

function resolveInputPath(inputPath: string, cwd: string): string {
  return isAbsolute(inputPath) ? inputPath : resolve(cwd, inputPath);
}

function isInsideOrEqualPath(rootPath: string, targetPath: string): boolean {
  const relativePath = relative(rootPath, targetPath);
  return (
    relativePath === "" ||
    (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
  );
}

function validatePipelineDeclaration(value: unknown): readonly ConfigIssue[] {
  const issues: ConfigIssue[] = [];

  if (!isRecord(value)) {
    return [
      pipelineDeclarationIssue({
        code: "pipeline_declaration_invalid",
        message: "Pipeline declaration must be a JSON object."
      })
    ];
  }

  issues.push(...validateAllowedFields(value, PIPELINE_DECLARATION_FIELDS, [], "pipeline_unknown_field"));

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
    issues.push(...validateSourceDeclaration(source, index));
  }
  issues.push(
    ...validateUniqueDeclarationIds({
      entries: value.sources,
      collectionPath: "sources",
      duplicateCode: "pipeline_source_id_duplicate",
      duplicateMessage: "Pipeline source ids must be unique."
    })
  );

  if (value.limits !== undefined) {
    issues.push(...validateResourceLimitsDeclaration(value.limits));
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
      issues.push(...validateValidatorDeclaration(validator, index));
    }
    issues.push(
      ...validateUniqueDeclarationIds({
        entries: value.validators,
        collectionPath: "validators",
        duplicateCode: "pipeline_validator_id_duplicate",
        duplicateMessage: "Pipeline validator ids must be unique."
      })
    );
    issues.push(...validateDisjointDeclarationIds(value.sources, value.validators));
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
      issues.push(...validateCoercionRuleDeclaration(rule, index));
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
          issues.push(...validateOverrideMappingDeclaration(mapping, source.kind, [...sourcePath("mappings"), mappingIndex], sourceId));
        }
        issues.push(...validateUniqueMappingTargetPaths(source.mappings, sourcePath("mappings"), sourceId));
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

export function sourceLoadFailedIssue(error: unknown): ConfigIssue {
  return sourceLoadFailedIssues(error)[0] ?? {
    category: "source-load",
    code: "pipeline_declaration_load_failed",
    severity: "error",
    message: "Failed to load pipeline declaration."
  };
}

export function sourceLoadFailedIssues(error: unknown): readonly ConfigIssue[] {
  if (error instanceof PipelineDeclarationError) {
    return error.issues;
  }

  return [
    {
      category: "source-load",
      code: "pipeline_declaration_load_failed",
      severity: "error",
      message: "Failed to load pipeline declaration. Exception details were omitted from diagnostics."
    }
  ];
}

function pipelineDeclarationIssue(input: {
  readonly code: string;
  readonly message: string;
  readonly path?: ConfigPath | undefined;
  readonly sourceId?: string | undefined;
}): ConfigIssue {
  return {
    category: "source-load",
    code: input.code,
    severity: "error",
    message: input.message,
    ...(input.path === undefined ? {} : { path: input.path }),
    ...(input.sourceId === undefined ? {} : { sourceId: input.sourceId })
  };
}

function validateAllowedFields(
  value: Readonly<Record<string, unknown>>,
  allowedFields: ReadonlySet<string>,
  path: ConfigPath,
  code: string,
  sourceId?: string | undefined
): readonly ConfigIssue[] {
  return Object.keys(value)
    .filter((field) => !allowedFields.has(field))
    .map((field) =>
      pipelineDeclarationIssue({
        code,
        path: [...path, field],
        sourceId,
        message: `Unknown pipeline declaration field ${formatConfigPath([...path, field])}.`
      })
    );
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

    issues.push(
      pipelineDeclarationIssue({
        code: input.duplicateCode,
        path: [input.collectionPath, index, "id"],
        sourceId: entry.id,
        message: `${input.duplicateMessage} Duplicate id ${entry.id} was first declared at ${input.collectionPath}.${firstIndex}.id.`
      })
    );
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

    issues.push(
      pipelineDeclarationIssue({
        code: "pipeline_declaration_id_namespace_collision",
        path: ["validators", index, "id"],
        sourceId: validator.id,
        message: `Pipeline validator id ${validator.id} conflicts with source id declared at sources.${sourceIndex}.id.`
      })
    );
  }

  return issues;
}

function validateUniqueMappingTargetPaths(
  mappings: readonly unknown[],
  path: ConfigPath,
  sourceId: string | undefined
): readonly ConfigIssue[] {
  const seenTargetPaths: { readonly index: number; readonly targetPath: ConfigPath }[] = [];
  const issues: ConfigIssue[] = [];

  for (const [index, mapping] of mappings.entries()) {
    if (!isRecord(mapping) || !isStringOnlyConfigPath(mapping.targetPath)) {
      continue;
    }

    const targetPath = mapping.targetPath;
    const existing = seenTargetPaths.find((candidate) => pathsEqual(candidate.targetPath, targetPath));

    if (existing === undefined) {
      seenTargetPaths.push({ index, targetPath });
      continue;
    }

    issues.push(
      pipelineDeclarationIssue({
        code: "pipeline_override_mapping_target_path_duplicate",
        path: [...path, index, "targetPath"],
        sourceId,
        message: `Override mapping targetPath duplicates mappings.${existing.index}.targetPath.`
      })
    );
  }

  return issues;
}

function unionAllowedFields(left: ReadonlySet<string>, right: ReadonlySet<string>): ReadonlySet<string> {
  return new Set([...left, ...right]);
}

function formatConfigPath(path: ConfigPath): string {
  return path.length === 0 ? "<root>" : path.map(String).join(".");
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isConfigPath(value: unknown): value is ConfigPath {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((segment) => typeof segment === "string" || typeof segment === "number")
  );
}

function isStringOnlyConfigPath(value: unknown): value is ConfigPath {
  return Array.isArray(value) && value.length > 0 && value.every((segment) => typeof segment === "string");
}
