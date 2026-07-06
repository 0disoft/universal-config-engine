import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
  createArgvSource,
  createProcessEnvSource,
  loadDotenvFileSource,
  loadJsonFileSource
} from "@universal-config-engine/node";
import type {
  ConfigPath,
  ConfigIssue,
  ConfigSourceDescriptor,
  LoadedSource,
  RedactionPolicyInput,
  SourceKind
} from "@universal-config-engine/core";
import type {
  PipelineDeclaration,
  PipelineSourceDeclaration
} from "./types.js";

const SUPPORTED_SOURCE_KINDS = new Set(["object", "json-file", "dotenv-file", "process-env", "argv"]);

export class PipelineDeclarationError extends Error {
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    super("Pipeline declaration is invalid.");
    this.name = "PipelineDeclarationError";
    this.issues = issues;
  }
}

export async function loadPipelineDeclaration(configPath: string, cwd = process.cwd()): Promise<PipelineDeclaration> {
  const raw = await readFile(resolveInputPath(configPath, cwd), "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const issues = validatePipelineDeclaration(parsed);

  if (issues.length > 0) {
    throw new PipelineDeclarationError(issues);
  }

  return parsed as PipelineDeclaration;
}

export async function loadDeclaredSources(input: {
  readonly declaration: PipelineDeclaration;
  readonly configPath: string;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly argv: readonly string[];
}): Promise<readonly LoadedSource[]> {
  const sources: LoadedSource[] = [];

  for (const source of input.declaration.sources) {
    const descriptor = createDescriptor(source);

    switch (source.kind) {
      case "object":
        sources.push({
          descriptor,
          value: source.value
        });
        break;
      case "json-file":
        sources.push(
          await loadJsonFileSource(
            source.maxFileBytes === undefined
              ? {
                  descriptor,
                  filePath: resolveConfigRelativePath(input.configPath, input.cwd, source.path)
                }
              : {
                  descriptor,
                  filePath: resolveConfigRelativePath(input.configPath, input.cwd, source.path),
                  maxFileBytes: source.maxFileBytes
                }
          )
        );
        break;
      case "dotenv-file":
        sources.push(
          await loadDotenvFileSource(
            source.maxFileBytes === undefined
              ? {
                  descriptor,
                  filePath: resolveConfigRelativePath(input.configPath, input.cwd, source.path)
                }
              : {
                  descriptor,
                  filePath: resolveConfigRelativePath(input.configPath, input.cwd, source.path),
                  maxFileBytes: source.maxFileBytes
                }
          )
        );
        break;
      case "process-env":
        sources.push(
          createProcessEnvSource({
            descriptor,
            env: input.env,
            mappings: source.mappings
          })
        );
        break;
      case "argv":
        sources.push(
          createArgvSource({
            descriptor,
            argv: input.argv,
            mappings: source.mappings
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

function createDescriptor(source: PipelineSourceDeclaration): ConfigSourceDescriptor {
  const base = {
    id: source.id,
    kind: source.kind as SourceKind,
    priority: source.priority,
    displayName: source.displayName ?? source.id
  };

  return source.redaction === undefined
    ? base
    : {
        ...base,
        redaction: source.redaction as RedactionPolicyInput
      };
}

function resolveConfigRelativePath(configPath: string, cwd: string, targetPath: string): string {
  if (isAbsolute(targetPath)) {
    return targetPath;
  }

  const absoluteConfigPath = isAbsolute(configPath) ? configPath : resolve(cwd, configPath);
  return resolve(absoluteConfigPath, "..", targetPath);
}

function resolveInputPath(inputPath: string, cwd: string): string {
  return isAbsolute(inputPath) ? inputPath : resolve(cwd, inputPath);
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

  if (value.validators !== undefined && !Array.isArray(value.validators)) {
    issues.push(
      pipelineDeclarationIssue({
        code: "pipeline_validators_invalid",
        path: ["validators"],
        message: "Pipeline validators must be an array when provided."
      })
    );
  }

  if (value.coercionRules !== undefined && !Array.isArray(value.coercionRules)) {
    issues.push(
      pipelineDeclarationIssue({
        code: "pipeline_coercion_rules_invalid",
        path: ["coercionRules"],
        message: "Pipeline coercionRules must be an array when provided."
      })
    );
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
      break;
    case "process-env":
    case "argv":
      if (!Array.isArray(source.mappings)) {
        issues.push(
          pipelineDeclarationIssue({
            code: "pipeline_override_mappings_invalid",
            path: sourcePath("mappings"),
            sourceId,
            message: "Override sources must include a mappings array."
          })
        );
      }
      break;
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
      message: error instanceof Error ? error.message : "Failed to load pipeline declaration."
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
