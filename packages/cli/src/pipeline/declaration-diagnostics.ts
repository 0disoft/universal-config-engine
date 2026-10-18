import { combineConfigIssues, type ConfigPath, type ConfigIssue } from "@0disoft/universal-config-engine-core";
import { MAX_PIPELINE_DECLARATION_DIAGNOSTICS } from "./declaration-fields.js";

export class PipelineDeclarationError extends Error {
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    super("Pipeline declaration is invalid.");
    this.name = "PipelineDeclarationError";
    this.issues = boundPipelineDeclarationIssues(issues);
  }
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
      message: "Failed to load pipeline declaration. Exception details were omitted from diagnostics."
    }
  ];
}

export function pipelineDeclarationIssue(input: {
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

export function appendDeclarationIssues(
  destination: ConfigIssue[],
  nextIssues: readonly ConfigIssue[]
): boolean {
  const combined = combineConfigIssues(destination, nextIssues, MAX_PIPELINE_DECLARATION_DIAGNOSTICS);
  // Keep caller-supplied markers intact; only the marker created by core gets CLI wording.
  const bounded = combined.map((issue) =>
    isDeclarationDiagnosticsOverflowMarker(issue) &&
    !destination.includes(issue) &&
    !nextIssues.includes(issue)
      ? {
          ...issue,
          message: `Pipeline declaration diagnostics exceeded the bootstrap maximum of ${MAX_PIPELINE_DECLARATION_DIAGNOSTICS}.`
        }
      : issue
  );
  destination.splice(0, destination.length, ...bounded);
  return !destination.some(isDeclarationDiagnosticsOverflowMarker);
}

function boundPipelineDeclarationIssues(issues: readonly ConfigIssue[]): readonly ConfigIssue[] {
  if (issues.length <= MAX_PIPELINE_DECLARATION_DIAGNOSTICS) {
    return issues;
  }
  const bounded: ConfigIssue[] = [];
  appendDeclarationIssues(bounded, issues);
  return bounded;
}

function isDeclarationDiagnosticsOverflowMarker(issue: ConfigIssue): boolean {
  return issue.category === "resource-limit" && issue.code === "max_diagnostics_exceeded";
}
