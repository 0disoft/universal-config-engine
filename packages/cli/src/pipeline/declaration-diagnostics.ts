import type { ConfigPath, ConfigIssue } from "@0disoft/universal-config-engine-core";
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
  for (const [index, issue] of nextIssues.entries()) {
    if (destination.length >= MAX_PIPELINE_DECLARATION_DIAGNOSTICS) {
      replaceLastDeclarationIssueWithOverflowMarker(destination);
      return false;
    }
    destination.push(issue);
    if (
      index < nextIssues.length - 1 &&
      destination.length >= MAX_PIPELINE_DECLARATION_DIAGNOSTICS
    ) {
      replaceLastDeclarationIssueWithOverflowMarker(destination);
      return false;
    }
  }
  return !destination.some(isDeclarationDiagnosticsOverflowMarker);
}

function replaceLastDeclarationIssueWithOverflowMarker(issues: ConfigIssue[]): void {
  if (issues.some(isDeclarationDiagnosticsOverflowMarker)) {
    return;
  }
  const marker: ConfigIssue = {
    category: "resource-limit",
    code: "max_diagnostics_exceeded",
    severity: "error",
    message: `Pipeline declaration diagnostics exceeded the bootstrap maximum of ${MAX_PIPELINE_DECLARATION_DIAGNOSTICS}.`
  };
  if (issues.length === 0) {
    issues.push(marker);
  } else {
    issues.length = Math.min(issues.length, MAX_PIPELINE_DECLARATION_DIAGNOSTICS);
    issues[issues.length - 1] = marker;
  }
}

function boundPipelineDeclarationIssues(issues: readonly ConfigIssue[]): readonly ConfigIssue[] {
  if (issues.length <= MAX_PIPELINE_DECLARATION_DIAGNOSTICS) {
    return issues;
  }
  const bounded = issues.slice(0, MAX_PIPELINE_DECLARATION_DIAGNOSTICS);
  replaceLastDeclarationIssueWithOverflowMarker(bounded);
  return bounded;
}

function isDeclarationDiagnosticsOverflowMarker(issue: ConfigIssue): boolean {
  return issue.category === "resource-limit" && issue.code === "max_diagnostics_exceeded";
}
