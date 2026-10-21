import { dirname, relative, sep } from "node:path";
import {
  createArgvSource,
  createProcessEnvSource,
  loadDotenvFileSource,
  loadJsonFileSource,
  loadConfigFileSource
} from "@0disoft/universal-config-engine-node";
import type {
  ConfigPath,
  ConfigIssue,
  ConfigSourceDescriptor,
  LoadedSource,
  RedactionPolicyInput,
  SourceKind
} from "@0disoft/universal-config-engine-core";
import { pathsEqual } from "@0disoft/universal-config-engine-core";
import type { PipelineDeclaration, PipelineSourceDeclaration } from "../types.js";
import { resolveConfigRelativePath } from "./source-paths.js";
import { PipelineDeclarationError } from "./declaration-diagnostics.js";
import { validateSourceBudget } from "./declaration-validation.js";

export async function loadDeclaredSources(input: {
  readonly declaration: PipelineDeclaration;
  readonly configPath: string;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly argv: readonly string[];
  readonly sourceConfigPaths?: ReadonlyMap<string, string>;
  readonly workspacePath?: string;
}): Promise<readonly LoadedSource[]> {
  const budgetIssues = validateSourceBudget(input.declaration.sources.length, input.declaration.limits);
  if (budgetIssues.length > 0) throw new PipelineDeclarationError(budgetIssues);
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
      case "dotenv-file":
      case "adapter": {
        const filePath = await resolveConfigRelativePath({
          configPath: input.sourceConfigPaths?.get(source.id) ?? input.configPath, cwd: input.cwd, sourceIndex: index,
          sourceId: descriptor.id, targetPath: source.path,
          ...(input.workspacePath === undefined ? {} : { allowedRootPath: input.workspacePath })
        });
        if (!filePath.ok) {
          sources.push(failedDeclaredSource(descriptor, filePath.issue));
          break;
        }
        const fileInput = { descriptor, filePath: filePath.path, allowedRootPath: filePath.allowedRootPath,
          ...(source.maxFileBytes === undefined ? {} : { maxFileBytes: source.maxFileBytes }) };
        const loaded = source.kind === "adapter"
          ? await loadConfigFileSource({ ...fileInput, format: source.format,
              ...(input.declaration.limits === undefined ? {} : { limits: input.declaration.limits }),
              ...(source.allowTrailingComma === undefined ? {} : { allowTrailingComma: source.allowTrailingComma }) })
          : source.kind === "json-file" ? await loadJsonFileSource(fileInput) : await loadDotenvFileSource(fileInput);
        sources.push(withCliSourcePaths(loaded, input.configPath));
        break;
      }
      case "process-env":
        sources.push(
          createProcessEnvSource({
            descriptor,
            env: input.env,
            mappings: source.mappings,
            ...(source.maxEnvEntries === undefined ? {} : { maxEnvEntries: source.maxEnvEntries }),
            ...(source.unmappedBehavior === undefined ? {} : { unmappedBehavior: source.unmappedBehavior }),
            ...(source.unmappedPrefix === undefined ? {} : { unmappedPrefix: source.unmappedPrefix })
          })
        );
        break;
      case "argv":
        sources.push(
          createArgvSource({
            descriptor,
            argv: input.argv,
            mappings: source.mappings,
            ...(source.maxArgvEntries === undefined ? {} : { maxArgvEntries: source.maxArgvEntries }),
            ...(source.unmappedBehavior === undefined ? {} : { unmappedBehavior: source.unmappedBehavior })
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

function withCliSourcePaths(source: LoadedSource, configPath: string): LoadedSource {
  if (source.locations === undefined) return source;
  const configDirectory = dirname(configPath);
  return {
    ...source,
    locations: source.locations.map((valueLocation) => ({
      path: valueLocation.path,
      location: {
        ...valueLocation.location,
        ...(valueLocation.location.sourcePath === undefined
          ? {}
          : {
              sourcePath: relative(configDirectory, valueLocation.location.sourcePath)
                .split(sep)
                .join("/")
            })
      }
    }))
  };
}

function failedDeclaredSource(descriptor: ConfigSourceDescriptor, issue: ConfigIssue): LoadedSource {
  return {
    descriptor,
    value: {},
    issues: [issue]
  };
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
