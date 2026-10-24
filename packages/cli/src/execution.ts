import { loadConfig } from "@0disoft/universal-config-engine-node";
import { createAjvValidator } from "@0disoft/universal-config-engine-validator-ajv";
import type { ConfigResult, RunConfigPipelineResult } from "@0disoft/universal-config-engine-core";
import { sourceLoadFailedIssues, type PipelineDeclarationReadPolicy } from "./pipeline.js";
import type { CliRuntime } from "./types.js";

/** Compatibility wrapper; applications and CLI now share the Node execution API. */
export function executeDeclaration(configPath: string, runtime: CliRuntime, argv: readonly string[], validate: boolean,
  policy: PipelineDeclarationReadPolicy = {}): Promise<RunConfigPipelineResult> {
  return loadConfig({ ...policy, configPath, cwd: runtime.cwd, env: runtime.env, argv, validate,
    validatorFactory: createAjvValidator });
}

export function declarationFailure(error: unknown): ConfigResult {
  const issues = sourceLoadFailedIssues(error);
  return {
    ok: false, config: {}, sources: [], issues, provenance: [], resolvedPaths: [],
    limits: { maxDepth: 0, maxKeyCount: 0, maxPathLength: 0, maxDiagnostics: Math.max(1, issues.length),
      maxSources: 1, maxProvenanceEvents: 1, maxResolvedPaths: 1, maxReportBytes: 4 * 1024 * 1024 }
  };
}
