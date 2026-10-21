import type { ConfigInspection } from "@0disoft/universal-config-engine-core";

/** JSON encoding also neutralizes control characters in paths, source ids and values. */
export function formatInspection(inspection: ConfigInspection, json: boolean): string {
  if (json) return `${JSON.stringify({ command: "explain", ...inspection }, null, 2)}\n`;
  const priorities = new Map(inspection.diagnostics.sources.map((source) => [source.id, source.priority]));
  const lines = [`command: explain`, `status: ${inspection.status}`, `path: ${JSON.stringify(inspection.path)}`];
  for (const entry of inspection.entries) {
    const value = entry.visibility === "redacted" ? "<redacted>" : entry.visibility === "container"
      ? `<${entry.type}>` : `${JSON.stringify(entry.value)}${entry.truncated ? " <truncated>" : ""}`;
    lines.push(`${JSON.stringify(entry.path)} = ${value}`);
    if (entry.source !== undefined) {
      lines.push(`  source: ${JSON.stringify(entry.source.winningSourceId)} priority=${priorities.get(entry.source.winningSourceId)} overridden: ${JSON.stringify(entry.source.overriddenSourceIds)}`);
      if (entry.source.winningLocation !== undefined) lines.push(`  location: ${JSON.stringify(entry.source.winningLocation)}`);
    }
  }
  for (const event of inspection.diagnostics.provenance) {
    lines.push(`history: ${JSON.stringify(event.path)} ${event.action} ${JSON.stringify(event.sourceId)} ${JSON.stringify(event.message)}`);
  }
  for (const issue of inspection.diagnostics.issues) lines.push(`issue: ${issue.category}/${issue.code} ${JSON.stringify(issue.message)}`);
  return `${lines.join("\n")}\n`;
}
