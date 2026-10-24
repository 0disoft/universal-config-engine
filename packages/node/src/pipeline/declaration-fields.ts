import type { ConfigPath } from "@0disoft/universal-config-engine-core";

export const SUPPORTED_SOURCE_KINDS = new Set(["object", "json-file", "dotenv-file", "adapter", "process-env", "argv"]);
export const SUPPORTED_FILE_FORMATS = new Set(["json", "jsonc", "yaml", "toml", "json5"]);

export const SUPPORTED_MAPPING_PARSE_AS = new Set(["string", "number", "boolean", "json"]);

export const SUPPORTED_COERCION_TARGETS = new Set(["number", "boolean", "json"]);

export const SUPPORTED_VALIDATOR_KINDS = new Set(["json-schema-ajv"]);

export const RESOURCE_LIMIT_FIELDS = [
  "maxDepth", "maxKeyCount", "maxPathLength", "maxDiagnostics", "maxSources",
  "maxProvenanceEvents", "maxResolvedPaths", "maxReportBytes"
] as const;

export const PIPELINE_DECLARATION_FIELDS = new Set(["sources", "validators", "coercionRules", "limits", "profiles", "extends"]);
export const PROFILE_DECLARATION_FIELDS = new Set(["sources", "validators", "coercionRules", "limits"]);

export const BASE_SOURCE_FIELDS = new Set(["id", "kind", "priority", "displayName", "redaction"]);

export const SOURCE_KIND_FIELDS: Readonly<Record<string, ReadonlySet<string>>> = {
  object: new Set(["value"]),
  "json-file": new Set(["path", "maxFileBytes"]),
  "dotenv-file": new Set(["path", "maxFileBytes"]),
  adapter: new Set(["format", "path", "maxFileBytes", "allowTrailingComma"]),
  "process-env": new Set(["mappings", "maxEnvEntries", "unmappedBehavior", "unmappedPrefix"]),
  argv: new Set(["mappings", "maxArgvEntries", "unmappedBehavior"])
};

export const OVERRIDE_MAPPING_FIELDS = new Set(["externalName", "targetPath", "sourceKind", "parseAs", "secret"]);

export const COERCION_RULE_FIELDS = new Set(["path", "from", "to", "onFailure"]);

export const VALIDATOR_DECLARATION_FIELDS = new Set(["id", "kind", "schema", "includeConstraints"]);

export const REDACTION_POLICY_FIELDS = new Set(["secretSource", "secretPaths", "secretNamePatterns"]);

export const MAX_PIPELINE_DECLARATION_DIAGNOSTICS = 200;

export function formatConfigPath(path: ConfigPath): string {
  return path.length === 0 ? "<root>" : path.map(String).join(".");
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function isProfileName(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value) &&
    value !== "constructor" && value !== "prototype";
}

/** Profiles cannot introduce nested profiles or inheritance. */
export function profileToDeclaration(value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return { sources: value.sources === undefined ? [] : value.sources,
    ...(value.validators === undefined ? {} : { validators: value.validators }),
    ...(value.coercionRules === undefined ? {} : { coercionRules: value.coercionRules }),
    ...(value.limits === undefined ? {} : { limits: value.limits }) };
}

export function isConfigPath(value: unknown): value is ConfigPath {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((segment) => typeof segment === "string" || typeof segment === "number")
  );
}

export function isStringOnlyConfigPath(value: unknown): value is ConfigPath {
  return Array.isArray(value) && value.length > 0 && value.every((segment) => typeof segment === "string");
}
