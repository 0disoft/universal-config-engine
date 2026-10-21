import type { ConfigDiff } from "@0disoft/universal-config-engine-core";

export function formatDiff(report: ConfigDiff, json: boolean): string {
  if (json) return `${JSON.stringify({ command: "diff", ...report }, null, 2)}\n`;
  const lines = [`command: diff`, `status: ${report.status}`, `secret comparison: ${report.secretComparison}`];
  if (report.error !== undefined) lines.push(`error: ${report.error}`);
  for (const change of report.changes) {
    lines.push(`${JSON.stringify(change.path)}: ${change.kinds.join(", ")}`);
    for (const side of ["before", "after"] as const) {
      const entry = change[side];
      if (entry === undefined) continue;
      const value = entry.visibility === "visible" ? `${JSON.stringify(entry.value)}${entry.truncated ? " <truncated>" : ""}`
        : entry.visibility === "redacted" ? "<redacted>" : `<${entry.type}>`;
      lines.push(`  ${side}: ${value} source=${JSON.stringify(entry.source?.winningSourceId ?? null)}`);
    }
  }
  for (const path of report.uncomparedSecretPaths) lines.push(`uncompared secret: ${JSON.stringify(path)}`);
  for (const side of ["before", "after"] as const) {
    for (const issue of report[side].diagnostics.issues) lines.push(`${side}: ${issue.category}/${issue.code} ${JSON.stringify(issue.message)}`);
  }
  return `${lines.join("\n")}\n`;
}
