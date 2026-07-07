import type { ConfigIssue, ConfigResult } from "@universal-config-engine/core";

export const EXIT_SUCCESS = 0;
export const EXIT_VALIDATION_FAILED = 1;
export const EXIT_SOURCE_FAILED = 2;
export const EXIT_POLICY_FAILED = 3;
export const EXIT_USAGE_ERROR = 4;
export const EXIT_REDACTION_FAILED = 5;

export function exitCodeForResult(result: ConfigResult): number {
  if (result.ok) {
    return EXIT_SUCCESS;
  }

  return exitCodeForIssues(result.issues);
}

export function exitCodeForIssues(issues: readonly ConfigIssue[]): number {
  if (issues.some((issue) => issue.category === "usage")) {
    return EXIT_USAGE_ERROR;
  }

  if (issues.some((issue) => issue.category === "redaction")) {
    return EXIT_REDACTION_FAILED;
  }

  if (issues.some((issue) => issue.category === "source-load" || issue.category === "parse")) {
    return EXIT_SOURCE_FAILED;
  }

  if (
    issues.some(
      (issue) =>
        issue.category === "mapping" ||
        issue.category === "merge" ||
        issue.category === "coercion" ||
        issue.category === "resource-limit"
    )
  ) {
    return EXIT_POLICY_FAILED;
  }

  if (issues.some((issue) => issue.category === "validation")) {
    return EXIT_VALIDATION_FAILED;
  }

  return EXIT_POLICY_FAILED;
}
