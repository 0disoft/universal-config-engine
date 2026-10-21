import type {
  CoercionRule,
  ConfigPath,
  OverrideMapping,
  RedactionPolicyInput,
  ResourceLimitPolicy
} from "@0disoft/universal-config-engine-core";
import type { ConfigFileFormat } from "@0disoft/universal-config-engine-node";
import type {
  PipelineDeclaration,
  PipelineValidatorDeclaration,
  PipelineSourceDeclaration
} from "../types.js";
import { PipelineDeclarationError, pipelineDeclarationIssue } from "./declaration-diagnostics.js";
import { isRecord, isPositiveInteger, profileToDeclaration } from "./declaration-fields.js";

export function normalizePipelineDeclaration(value: unknown): PipelineDeclaration {
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
    ...(Array.isArray(value.extends) ? { extends: value.extends.map(path => String(path)) } : {}),
    ...(Array.isArray(value.validators)
      ? { validators: value.validators.map((validator) => normalizeValidatorDeclaration(validator)) }
      : {}),
    ...(Array.isArray(value.coercionRules)
      ? { coercionRules: value.coercionRules.map((rule) => normalizeCoercionRuleDeclaration(rule)) }
      : {}),
    ...(isRecord(value.limits) ? { limits: normalizeResourceLimitsDeclaration(value.limits) } : {}),
    ...(isRecord(value.profiles) ? { profiles: Object.fromEntries(Object.entries(value.profiles).map(([name, profile]) => {
      if (!isRecord(profile)) throw new Error("Invalid profile reached normalization.");
      return [name, normalizePipelineDeclaration(profileToDeclaration(profile))];
    })) } : {})
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
    case "adapter":
      return {
        ...base, kind: "adapter", path: stringField(source, "path"),
        format: stringField(source, "format") as ConfigFileFormat,
        ...optionalPositiveIntegerField(source, "maxFileBytes"),
        ...optionalBooleanField(source, "allowTrailingComma")
      };
    case "process-env":
      return {
        ...base,
        kind: "process-env",
        mappings: arrayField(source, "mappings").map((mapping) => normalizeOverrideMapping(mapping, "process-env")),
        ...optionalPositiveIntegerField(source, "maxEnvEntries"),
        ...optionalUnmappedBehaviorField(source),
        ...optionalStringField(source, "unmappedPrefix")
      };
    case "argv":
      return {
        ...base,
        kind: "argv",
        mappings: arrayField(source, "mappings").map((mapping) => normalizeOverrideMapping(mapping, "argv")),
        ...optionalPositiveIntegerField(source, "maxArgvEntries"),
        ...optionalUnmappedBehaviorField(source)
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
    ...optionalPositiveIntegerField(limits, "maxDiagnostics"),
    ...optionalPositiveIntegerField(limits, "maxSources"),
    ...optionalPositiveIntegerField(limits, "maxProvenanceEvents"),
    ...optionalPositiveIntegerField(limits, "maxResolvedPaths"),
    ...optionalPositiveIntegerField(limits, "maxReportBytes")
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

function optionalUnmappedBehaviorField(
  record: Readonly<Record<string, unknown>>
): { readonly unmappedBehavior?: "warning" | "error" } {
  return record.unmappedBehavior === undefined
    ? {}
    : { unmappedBehavior: record.unmappedBehavior as "warning" | "error" };
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
