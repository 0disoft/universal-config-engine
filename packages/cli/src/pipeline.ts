import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
  createArgvSource,
  createProcessEnvSource,
  loadDotenvFileSource,
  loadJsonFileSource
} from "@universal-config-engine/node";
import type {
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

export async function loadPipelineDeclaration(configPath: string, cwd = process.cwd()): Promise<PipelineDeclaration> {
  const raw = await readFile(resolveInputPath(configPath, cwd), "utf8");
  const parsed = JSON.parse(raw) as unknown;

  if (!isPipelineDeclaration(parsed)) {
    throw new Error("Pipeline declaration must contain a sources array.");
  }

  return parsed;
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

function isPipelineDeclaration(value: unknown): value is PipelineDeclaration {
  return (
    value !== null &&
    typeof value === "object" &&
    Array.isArray((value as { readonly sources?: unknown }).sources)
  );
}

export function sourceLoadFailedIssue(error: unknown): ConfigIssue {
  return {
    category: "source-load",
    code: "pipeline_declaration_load_failed",
    severity: "error",
    message: error instanceof Error ? error.message : "Failed to load pipeline declaration."
  };
}
