import { formatPath, type ConfigIssue, type DiagnosticReport } from "@universal-config-engine/core";
import type { CliCommand } from "./types.js";

export interface CliJsonReport extends DiagnosticReport {
  readonly command: CliCommand;
}

export function formatJsonReport(command: CliCommand, report: DiagnosticReport): string {
  const output: CliJsonReport = {
    command,
    ...report
  };
  return `${JSON.stringify(output, null, 2)}\n`;
}

export function formatHumanReport(command: CliCommand, report: DiagnosticReport): string {
  const lines: string[] = [];
  lines.push(`command: ${command}`);
  lines.push(`status: ${report.status}`);
  lines.push("sources:");

  for (const source of report.sources) {
    lines.push(`- ${source.id} (${source.kind}) priority=${source.priority} status=${source.status}`);
  }

  lines.push("resolved:");
  if (report.resolvedPaths.length === 0) {
    lines.push("- <none>");
  } else {
    for (const resolved of report.resolvedPaths) {
      const redaction = resolved.redacted ? ` redacted=${resolved.redactionReason ?? "true"}` : "";
      const overridden =
        resolved.overriddenSourceIds.length === 0
          ? ""
          : ` overridden=${resolved.overriddenSourceIds.join(",")}`;
      lines.push(`- ${formatPath(resolved.path)} source=${resolved.winningSourceId}${overridden}${redaction}`);
    }
  }

  lines.push("issues:");
  if (report.issues.length === 0) {
    lines.push("- <none>");
  } else {
    for (const issue of report.issues) {
      lines.push(`- ${formatIssue(issue)}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function formatIssue(issue: ConfigIssue): string {
  const path = issue.path === undefined ? "" : ` path=${formatPath(issue.path)}`;
  const source = issue.sourceId === undefined ? "" : ` source=${issue.sourceId}`;
  return `${issue.severity} ${issue.category}/${issue.code}${source}${path}: ${issue.message}`;
}
