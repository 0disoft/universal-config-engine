import { resolve } from "node:path";
import { readTextFileWithinLimit } from "@0disoft/universal-config-engine-node";
import type { ConfigChangeCheck, ConfigIssue } from "@0disoft/universal-config-engine-core";
import { formatDiff } from "./diff-output.js";

export async function loadChangePolicy(path: string, cwd: string): Promise<{ value?: unknown; issues: readonly ConfigIssue[] }> {
  let raw: string;
  try {
    const read = await readTextFileWithinLimit({ filePath: resolve(cwd, path), sourceId: "cli:change-policy", maxFileBytes: 1024 * 1024 });
    if (!read.ok) return { issues: read.issues };
    raw = read.raw;
  } catch {
    return { issues: [{ category: "source-load", code: "change_policy_load_failed", severity: "error", message: "Failed to read change policy. Exception details were omitted." }] };
  }
  try { return { value: JSON.parse(raw) as unknown, issues: [] }; }
  catch { return { issues: [{ category: "parse", code: "change_policy_parse_failed", severity: "error", message: "Invalid change policy JSON. Input and parser details were omitted." }] }; }
}

export function formatChangeCheck(report: ConfigChangeCheck, json: boolean): string {
  if (json) return `${JSON.stringify({ command: "diff", ...report }, null, 2)}\n`;
  const lines = [formatDiff({ ...report.diff, status: report.status }, false).trimEnd(), `policy: ${report.policy.status}`];
  for (const violation of report.policy.violations) {
    lines.push(`violation: ${violation.code} rule=${JSON.stringify(violation.ruleId ?? null)} path=${JSON.stringify(violation.path ?? [])}`);
  }
  return `${lines.join("\n")}\n`;
}
