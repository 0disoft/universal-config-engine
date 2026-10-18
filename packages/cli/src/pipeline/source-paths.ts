import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { ConfigIssue } from "@0disoft/universal-config-engine-core";
import { pipelineDeclarationIssue } from "./declaration-diagnostics.js";

export async function resolveConfigRelativePath(input: {
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

export function resolveInputPath(inputPath: string, cwd: string): string {
  return isAbsolute(inputPath) ? inputPath : resolve(cwd, inputPath);
}

function isInsideOrEqualPath(rootPath: string, targetPath: string): boolean {
  const relativePath = relative(rootPath, targetPath);
  return (
    relativePath === "" ||
    (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
  );
}
