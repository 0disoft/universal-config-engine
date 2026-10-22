import { appendBoundedIssues, isDiagnosticsLimitReached } from "./diagnostics.js";
import type { ConfigIssue, ConfigSourceDescriptor, ResolvedPath, SourceLocation } from "./types.js";

/** Compare metadata fields, independent of the adapter's object insertion order. */
export function sourceIdentity(
  source: Pick<ResolvedPath, "winningSourceId" | "overriddenSourceIds" | "winningLocation" | "overriddenLocations">,
  priorities: ReadonlyMap<string, number>
): string {
  return JSON.stringify([source.winningSourceId, priorities.get(source.winningSourceId),
    source.overriddenSourceIds.map(id => [id, priorities.get(id)]),
    locationIdentity(source.winningLocation), source.overriddenLocations?.map(locationIdentity)]);
}

function locationIdentity(location: SourceLocation | undefined) {
  return location === undefined ? undefined : [location.sourceId, location.sourcePath, location.line, location.column];
}

/** Reject known identity conflicts before loading; resolution reuses the same rule. */
export function duplicateSourceIdIssues(
  sources: readonly { readonly descriptor: ConfigSourceDescriptor }[],
  maxDiagnostics: number,
  indexOrder: "declared" | "sorted" = "declared"
): readonly ConfigIssue[] {
  const firstIndexById = new Map<string, number>();
  const issues: ConfigIssue[] = [];

  for (const [index, source] of sources.entries()) {
    const firstIndex = firstIndexById.get(source.descriptor.id);
    if (firstIndex === undefined) {
      firstIndexById.set(source.descriptor.id, index);
      continue;
    }
    appendBoundedIssues(
      issues,
      [
        {
          category: "source-load",
          code: "duplicate_source_id",
          severity: "error",
          sourceId: source.descriptor.id,
          message: `Source id duplicates the source declared at ${indexOrder} index ${firstIndex}.`
        }
      ],
      maxDiagnostics
    );
    if (isDiagnosticsLimitReached(issues, maxDiagnostics)) break;
  }

  return issues;
}
