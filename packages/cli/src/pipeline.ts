import {
  DEFAULT_MAX_FILE_BYTES,
  readTextFileWithinLimit
} from "@0disoft/universal-config-engine-node";
import type { PipelineDeclaration } from "./types.js";
import { resolveInputPath } from "./pipeline/source-paths.js";
import { normalizePipelineDeclaration } from "./pipeline/declaration-normalization.js";
import { PipelineDeclarationError } from "./pipeline/declaration-diagnostics.js";
import { validatePipelineDeclaration } from "./pipeline/declaration-validation.js";

export interface LoadedPipelineDeclaration {
  readonly declaration: PipelineDeclaration;
  readonly canonicalConfigPath: string;
}

export interface PipelineDeclarationReadPolicy {
  readonly allowedRootPath?: string;
}

export async function loadPipelineDeclaration(configPath: string, cwd = process.cwd(), policy: PipelineDeclarationReadPolicy = {}): Promise<PipelineDeclaration> {
  return (await loadPipelineDeclarationContext(configPath, cwd, policy)).declaration;
}

export async function loadPipelineDeclarationContext(
  configPath: string,
  cwd = process.cwd(),
  policy: PipelineDeclarationReadPolicy = {}
): Promise<LoadedPipelineDeclaration> {
  const readResult = await readTextFileWithinLimit({
    filePath: resolveInputPath(configPath, cwd),
    sourceId: "cli:pipeline-declaration",
    maxFileBytes: DEFAULT_MAX_FILE_BYTES,
    ...(policy.allowedRootPath === undefined ? {} : { allowedRootPath: policy.allowedRootPath })
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
    canonicalConfigPath: readResult.canonicalPath
  };
}

export { loadDeclaredSources } from "./pipeline/source-loading.js";

export {
  PipelineDeclarationError,
  sourceLoadFailedIssue,
  sourceLoadFailedIssues
} from "./pipeline/declaration-diagnostics.js";
