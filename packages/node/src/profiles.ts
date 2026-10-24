import type { PipelineDeclaration } from "./declaration-types.js";
import { PipelineDeclarationError } from "./pipeline/declaration-diagnostics.js";
import { validatePipelineDeclaration } from "./pipeline/declaration-validation.js";
import { normalizePipelineDeclaration } from "./pipeline/declaration-normalization.js";
import { isProfileName } from "./pipeline/declaration-fields.js";

/** Compile one explicitly selected profile without reading process environment. */
export function selectPipelineProfile(declaration: PipelineDeclaration, profile?: string): PipelineDeclaration {
  const issues = validatePipelineDeclaration(declaration);
  if (issues.length > 0) throw new PipelineDeclarationError(issues);
  if (profile !== undefined && (!isProfileName(profile) || !declaration.profiles || !Object.hasOwn(declaration.profiles, profile))) {
    throw new PipelineDeclarationError([{ category: "usage", code: "pipeline_profile_not_found", severity: "error",
      message: "The requested profile is not declared." }]);
  }
  const selected = profile === undefined ? undefined : declaration.profiles![profile];
  const compiled = {
    sources: [...declaration.sources, ...(selected?.sources ?? [])],
    ...(declaration.validators === undefined && selected?.validators === undefined ? {} : {
      validators: [...(declaration.validators ?? []), ...(selected?.validators ?? [])] }),
    ...(declaration.coercionRules === undefined && selected?.coercionRules === undefined ? {} : {
      coercionRules: [...(declaration.coercionRules ?? []), ...(selected?.coercionRules ?? [])] }),
    ...(declaration.limits === undefined && selected?.limits === undefined ? {} : {
      limits: { ...declaration.limits, ...selected?.limits } })
  };
  const combinedIssues = validatePipelineDeclaration(compiled);
  if (combinedIssues.length > 0) throw new PipelineDeclarationError(combinedIssues);
  return normalizePipelineDeclaration(compiled);
}
