import { DEFAULT_RESOURCE_LIMITS, type ConfigIssue } from "@0disoft/universal-config-engine-core";
import { isRecord, isProfileName, PROFILE_DECLARATION_FIELDS, profileToDeclaration } from "./declaration-fields.js";
import { appendDeclarationIssues, pipelineDeclarationIssue } from "./declaration-diagnostics.js";

export function validateProfiles(value: unknown, validate: (value: unknown) => readonly ConfigIssue[]): readonly ConfigIssue[] {
  if (value === undefined) return [];
  if (!isRecord(value)) return [pipelineDeclarationIssue({ code: "pipeline_profiles_invalid", path: ["profiles"],
    message: "Profiles must be a named object." })];
  const names = Object.keys(value);
  if (names.length > 64) return [{ category: "resource-limit", code: "max_profiles_exceeded", severity: "error",
    path: ["profiles"], message: "A declaration may contain at most 64 profiles." }];
  const issues: ConfigIssue[] = [];
  for (const name of names) {
    if (!isProfileName(name)) {
      if (!appendDeclarationIssues(issues, [pipelineDeclarationIssue({ code: "pipeline_profile_name_invalid", path: ["profiles"],
        message: "Profile names must be safe machine identifiers of at most 64 characters." })])) break;
      continue;
    }
    const profile = value[name];
    if (!isRecord(profile)) {
      if (!appendDeclarationIssues(issues, [pipelineDeclarationIssue({ code: "pipeline_profile_invalid", path: ["profiles", name],
        message: "Each profile must be an object." })])) break;
      continue;
    }
    const unknown = Object.keys(profile).some(key => !PROFILE_DECLARATION_FIELDS.has(key));
    if (unknown && !appendDeclarationIssues(issues, [pipelineDeclarationIssue({ code: "pipeline_profile_unknown_field", path: ["profiles", name],
      message: "Profiles only support sources, validators, coercionRules and limits." })])) break;
    const maximum = isRecord(profile.limits) && typeof profile.limits.maxSources === "number" &&
      Number.isSafeInteger(profile.limits.maxSources) && profile.limits.maxSources > 0
      ? profile.limits.maxSources : DEFAULT_RESOURCE_LIMITS.maxSources;
    if (Array.isArray(profile.sources) && profile.sources.length > maximum) {
      if (!appendDeclarationIssues(issues, [{ category: "resource-limit", code: "max_sources_exceeded", severity: "error",
        path: ["profiles", name, "sources"], message: "Profile source count exceeds its configured limit." }])) break;
      continue;
    }
    const nested = validate(profileToDeclaration(profile)).map(issue => ({ ...issue, path: ["profiles", name, ...(issue.path ?? [])] }));
    if (!appendDeclarationIssues(issues, nested)) break;
  }
  return issues;
}
