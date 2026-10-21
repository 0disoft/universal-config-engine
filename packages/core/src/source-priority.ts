import { appendBoundedIssues, isDiagnosticsLimitReached } from "./diagnostics.js";
import type { ConfigIssue, ConfigSourceDescriptor } from "./types.js";

/** Shared preflight, after the source-count check and before loading or sorting. */
export function sourcePriorityIssues(
  sources: readonly { readonly descriptor: ConfigSourceDescriptor }[],
  maxDiagnostics: number
): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  for (const { descriptor } of sources) {
    if (Number.isFinite(descriptor.priority)) continue;
    appendBoundedIssues(issues, [{ category: "source-load", code: "source_priority_invalid",
      severity: "error", sourceId: descriptor.id, message: "Source priority must be a finite number." }], maxDiagnostics);
    if (isDiagnosticsLimitReached(issues, maxDiagnostics)) break;
  }
  return issues;
}
