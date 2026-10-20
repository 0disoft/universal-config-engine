import type { ConfigIssue } from "./types.js";

/** Append in order, reserving the final slot for a marker only when input overflows. */
export function appendBoundedIssues(
  destination: ConfigIssue[],
  nextIssues: readonly ConfigIssue[],
  maxDiagnostics: number
): void {
  for (const issue of nextIssues) {
    if (destination.length >= maxDiagnostics) {
      markDiagnosticsOverflow(destination, maxDiagnostics);
      return;
    }
    destination.push(issue);
  }
}

export function markDiagnosticsOverflow(issues: ConfigIssue[], maxDiagnostics: number): void {
  if (issues.some(isDiagnosticsOverflowMarker)) {
    return;
  }
  const marker: ConfigIssue = {
    category: "resource-limit",
    code: "max_diagnostics_exceeded",
    severity: "error",
    message: `Diagnostics exceeded the maximum of ${maxDiagnostics}.`
  };
  if (issues.length === 0) {
    issues.push(marker);
  } else {
    issues[issues.length - 1] = marker;
  }
}

export function isDiagnosticsOverflowMarker(issue: ConfigIssue): boolean {
  return issue.category === "resource-limit" && issue.code === "max_diagnostics_exceeded" && issue.severity === "error";
}

export function isDiagnosticsLimitReached(issues: readonly ConfigIssue[], maxDiagnostics: number): boolean {
  return issues.length >= maxDiagnostics && issues.some(isDiagnosticsOverflowMarker);
}
