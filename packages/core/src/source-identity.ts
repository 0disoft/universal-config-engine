import type { ResolvedPath, SourceLocation } from "./types.js";

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
