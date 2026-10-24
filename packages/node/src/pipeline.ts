import { DEFAULT_MAX_FILE_BYTES, readTextFileWithinLimit } from "./file.js";
import type { ConfigOperationOptions } from "@0disoft/universal-config-engine-core";
import type { PipelineDeclaration } from "./declaration-types.js";
import { resolveInputPath } from "./pipeline/source-paths.js";
import { normalizePipelineDeclaration } from "./pipeline/declaration-normalization.js";
import { PipelineDeclarationError } from "./pipeline/declaration-diagnostics.js";
import { validatePipelineDeclaration } from "./pipeline/declaration-validation.js";
import { loadDeclarationInheritance, type ParsedPipelineDocument } from "./pipeline/inheritance.js";
import { selectPipelineProfile } from "./profiles.js";

export interface LoadedPipelineDeclaration {
  readonly declaration: PipelineDeclaration;
  readonly canonicalConfigPath: string;
  readonly workspacePath?: string;
  readonly sourceConfigPaths?: ReadonlyMap<string, string>;
  readonly declarationPaths?: readonly string[];
}

export interface PipelineDeclarationReadPolicy extends ConfigOperationOptions {
  readonly allowedRootPath?: string;
  readonly workspacePath?: string;
  readonly profile?: string;
}

export async function loadPipelineDeclaration(configPath: string, cwd = process.cwd(), policy: PipelineDeclarationReadPolicy = {}): Promise<PipelineDeclaration> {
  return (await loadPipelineDeclarationContext(configPath, cwd, policy)).declaration;
}

export async function loadPipelineDeclarationContext(
  configPath: string,
  cwd = process.cwd(),
  policy: PipelineDeclarationReadPolicy = {}
): Promise<LoadedPipelineDeclaration> {
  const resolvedPolicy = { ...policy,
    ...(policy.allowedRootPath === undefined ? {} : { allowedRootPath: resolveInputPath(policy.allowedRootPath, cwd) }),
    ...(policy.workspacePath === undefined ? {} : { workspacePath: resolveInputPath(policy.workspacePath, cwd) }) };
  const document = await readSingleDeclaration(resolveInputPath(configPath, cwd),
    resolvedPolicy.allowedRootPath ?? resolvedPolicy.workspacePath, DEFAULT_MAX_FILE_BYTES, policy);
  if ((document.declaration.extends?.length ?? 0) > 0 || resolvedPolicy.workspacePath !== undefined) {
    return loadDeclarationInheritance(document, resolvedPolicy, (path, workspace, maximum) => readSingleDeclaration(path, workspace, maximum, policy));
  }
  return { declaration: policy.profile === undefined ? document.declaration : selectPipelineProfile(document.declaration, policy.profile),
    canonicalConfigPath: document.canonicalConfigPath };
}

async function readSingleDeclaration(filePath: string, allowedRootPath: string | undefined, maxFileBytes: number,
  options: ConfigOperationOptions): Promise<ParsedPipelineDocument> {
  const readResult = await readTextFileWithinLimit({
    filePath,
    sourceId: "cli:pipeline-declaration",
    maxFileBytes,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.onError === undefined ? {} : { onError: options.onError }),
    ...(allowedRootPath === undefined ? {} : { allowedRootPath })
  });
  if (!readResult.ok) {
    throw new PipelineDeclarationError(readResult.issues);
  }

  const parsed = JSON.parse(readResult.raw) as unknown;
  const issues = validatePipelineDeclaration(parsed);

  if (issues.length > 0) {
    throw new PipelineDeclarationError(issues);
  }

  return {
    declaration: normalizePipelineDeclaration(parsed),
    canonicalConfigPath: readResult.canonicalPath,
    byteLength: new TextEncoder().encode(readResult.raw).byteLength
  };
}

export { loadDeclaredSources } from "./pipeline/source-loading.js";

export {
  PipelineDeclarationError,
  sourceLoadFailedIssue,
  sourceLoadFailedIssues
} from "./pipeline/declaration-diagnostics.js";
