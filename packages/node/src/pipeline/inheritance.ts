import { realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DEFAULT_RESOURCE_LIMITS, type ConfigIssue, type ResourceLimitPolicy } from "@0disoft/universal-config-engine-core";
import { selectPipelineProfile } from "../profiles.js";
import type { LoadedPipelineDeclaration, PipelineDeclarationReadPolicy } from "../pipeline.js";
import { PipelineDeclarationError } from "./declaration-diagnostics.js";
import { validatePipelineDeclaration } from "./declaration-validation.js";
import { normalizePipelineDeclaration } from "./declaration-normalization.js";
import { isInsideOrEqualPath } from "./source-paths.js";

export interface ParsedPipelineDocument extends LoadedPipelineDeclaration { readonly byteLength: number }

const MAX_DECLARATIONS = 16;
const MAX_DECLARATION_BYTES = 4 * 1024 * 1024;

export async function loadDeclarationInheritance(
  initial: ParsedPipelineDocument,
  policy: PipelineDeclarationReadPolicy,
  read: (path: string, workspace: string, maxBytes: number) => Promise<ParsedPipelineDocument>
): Promise<LoadedPipelineDeclaration> {
  const workspacePath = await realpath(policy.workspacePath ?? policy.allowedRootPath ?? dirname(initial.canonicalConfigPath));
  if (!isInsideOrEqualPath(workspacePath, initial.canonicalConfigPath)) throw failure("pipeline_inheritance_outside_workspace");
  if (policy.allowedRootPath !== undefined && !isInsideOrEqualPath(await realpath(policy.allowedRootPath), workspacePath)) {
    throw failure("pipeline_workspace_policy_conflict");
  }
  const seen = new Set([initial.canonicalConfigPath]);
  const active = new Set<string>();
  const complete = new Set<string>();
  const ordered: ParsedPipelineDocument[] = [];
  let bytes = initial.byteLength;
  async function visit(document: ParsedPipelineDocument): Promise<void> {
    active.add(document.canonicalConfigPath);
    for (const parent of document.declaration.extends ?? []) {
      const path = await realpath(resolve(dirname(document.canonicalConfigPath), parent));
      if (!isInsideOrEqualPath(workspacePath, path)) throw failure("pipeline_inheritance_outside_workspace");
      if (active.has(path)) throw failure("pipeline_inheritance_cycle");
      if (complete.has(path)) continue;
      if (seen.size >= MAX_DECLARATIONS) throw failure("max_declarations_exceeded", "resource-limit");
      const remaining = MAX_DECLARATION_BYTES - bytes;
      if (remaining <= 0) throw failure("max_declaration_bytes_exceeded", "resource-limit");
      seen.add(path);
      let loaded;
      try { loaded = await read(path, workspacePath, Math.min(1024 * 1024, remaining)); }
      catch (error) {
        if (remaining < 1024 * 1024 && error instanceof PipelineDeclarationError &&
            error.issues.some(issue => issue.code === "max_file_bytes_exceeded")) {
          throw failure("max_declaration_bytes_exceeded", "resource-limit");
        }
        throw error;
      }
      if (loaded.canonicalConfigPath !== path) throw failure("pipeline_inheritance_identity_changed");
      bytes += loaded.byteLength;
      await visit(loaded);
    }
    active.delete(document.canonicalConfigPath);
    complete.add(document.canonicalConfigPath);
    ordered.push(document);
  }
  await visit(initial);
  let matched = policy.profile === undefined;
  const declarations = ordered.map(document => {
    const selected = policy.profile !== undefined && document.declaration.profiles !== undefined &&
      Object.hasOwn(document.declaration.profiles, policy.profile);
    matched ||= selected;
    return { document, value: selectPipelineProfile(document.declaration, selected ? policy.profile : undefined) };
  });
  if (!matched) throw new PipelineDeclarationError([{ category: "usage", code: "pipeline_profile_not_found", severity: "error",
    message: "The requested profile is not declared." }]);
  const limits: Partial<ResourceLimitPolicy> = Object.assign({}, ...declarations.map(({ value }) => value.limits ?? {}));
  const maximum = typeof limits.maxSources === "number" && Number.isSafeInteger(limits.maxSources) && limits.maxSources > 0
    ? limits.maxSources : DEFAULT_RESOURCE_LIMITS.maxSources;
  if (declarations.reduce((count, { value }) => count + value.sources.length, 0) > maximum) {
    throw failure("max_sources_exceeded", "resource-limit");
  }
  const compiled = {
    sources: declarations.flatMap(({ document, value }) => value.sources.map(source =>
      source.kind === "json-file" || source.kind === "dotenv-file" || source.kind === "adapter"
        ? { ...source, path: resolve(dirname(document.canonicalConfigPath), source.path) } : source)),
    validators: declarations.flatMap(({ value }) => value.validators ?? []),
    coercionRules: declarations.flatMap(({ value }) => value.coercionRules ?? []), limits
  };
  const issues = validatePipelineDeclaration(compiled);
  if (issues.length > 0) throw new PipelineDeclarationError(issues);
  const sourceConfigPaths = new Map<string, string>();
  for (const { document, value } of declarations) for (const source of value.sources) sourceConfigPaths.set(source.id, document.canonicalConfigPath);
  return { declaration: normalizePipelineDeclaration(compiled), canonicalConfigPath: initial.canonicalConfigPath,
    workspacePath, sourceConfigPaths, declarationPaths: Object.freeze(ordered.map(document => document.canonicalConfigPath)) };
}

function failure(code: string, category: ConfigIssue["category"] = "source-load"): PipelineDeclarationError {
  return new PipelineDeclarationError([{ code, category, severity: "error",
    message: category === "resource-limit" ? "Declaration inheritance exceeded its configured resource budget."
      : "Declaration inheritance failed. Check cycles, workspace boundaries and file identity." }]);
}
