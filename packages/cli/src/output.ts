import { formatPath, type ConfigIssue, type DiagnosticReport } from "@0disoft/universal-config-engine-core";
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
    lines.push(
      `- ${escapeTerminalText(source.id)} (${escapeTerminalText(source.kind)}) ` +
      `priority=${source.priority} status=${escapeTerminalText(source.status)}`
    );
  }

  lines.push("resolved:");
  if (report.resolvedPaths.length === 0) {
    lines.push("- <none>");
  } else {
    for (const resolved of report.resolvedPaths) {
      const redaction = resolved.redacted
        ? ` redacted=${escapeTerminalText(resolved.redactionReason ?? "true")}`
        : "";
      const overridden =
        resolved.overriddenSourceIds.length === 0
          ? ""
          : ` overridden=${resolved.overriddenSourceIds.map(escapeTerminalText).join(",")}`;
      lines.push(
        `- ${escapeTerminalText(formatPath(resolved.path))} ` +
        `source=${escapeTerminalText(resolved.winningSourceId)}${overridden}${redaction}`
      );
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
  const path = issue.path === undefined ? "" : ` path=${escapeTerminalText(formatPath(issue.path))}`;
  const source = issue.sourceId === undefined ? "" : ` source=${escapeTerminalText(issue.sourceId)}`;
  return (
    `${escapeTerminalText(issue.severity)} ${escapeTerminalText(issue.category)}/` +
    `${escapeTerminalText(issue.code)}${source}${path}: ${escapeTerminalText(issue.message)}`
  );
}

function escapeTerminalText(value: string): string {
  let escaped = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (character === "\n") {
      escaped += "\\n";
    } else if (character === "\r") {
      escaped += "\\r";
    } else if (character === "\t") {
      escaped += "\\t";
    } else if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      escaped += `\\u${codePoint.toString(16).padStart(4, "0")}`;
    } else {
      escaped += character;
    }
  }
  return escaped;
}
