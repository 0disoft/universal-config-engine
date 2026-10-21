import { pathToKey } from "./path.js";
import type { ConfigIssueCategory, ConfigPath, DiagnosticReport, ProvenanceAction, SourceKind } from "./types.js";

export interface PublicDiagnosticReport {
  readonly schemaVersion: "public-diagnostic-1";
  readonly status: "ok" | "error";
  readonly sources: readonly { readonly id: string; readonly kind: SourceKind | "other"; readonly status: "loaded" | "failed" }[];
  readonly resolvedPaths: readonly { readonly path: string; readonly winningSource: string; readonly overriddenSources: readonly string[]; readonly redacted: boolean }[];
  readonly issues: readonly { readonly category: ConfigIssueCategory | "other"; readonly severity: "error" | "warning"; readonly source?: string; readonly path?: string }[];
  readonly provenance: readonly { readonly action: ProvenanceAction | "other"; readonly source: string; readonly previousSource?: string; readonly path: string }[];
  readonly truncated?: true;
}

const KINDS: readonly string[] = ["defaults", "object", "json-file", "dotenv-file", "process-env", "argv", "adapter"];
const CATEGORIES: readonly string[] = ["usage", "source-load", "parse", "mapping", "merge", "coercion", "validation", "redaction", "resource-limit"];
const ACTIONS: readonly string[] = ["defined", "overridden", "defaulted", "coerced", "validated", "redacted", "rejected"];

/** Allowlist projection: never retain arbitrary strings, values, names, paths or prose. */
export function buildPublicDiagnosticReport(report: DiagnosticReport): PublicDiagnosticReport {
  const sources = new Map<string, string>();
  const paths = new Map<string, string>();
  function source(id: string): string {
    if (!sources.has(id)) sources.set(id, `source-${sources.size + 1}`);
    return sources.get(id)!;
  }
  function path(value: ConfigPath): string {
    const key = pathToKey(value);
    if (!paths.has(key)) paths.set(key, `path-${paths.size + 1}`);
    return paths.get(key)!;
  }
  const projected: PublicDiagnosticReport = {
    schemaVersion: "public-diagnostic-1", status: report.status === "ok" ? "ok" : "error",
    sources: report.sources.map(entry => ({ id: source(entry.id), kind: KINDS.includes(entry.kind) ? entry.kind : "other",
      status: entry.status === "loaded" ? "loaded" : "failed" })),
    resolvedPaths: report.resolvedPaths.map(entry => ({ path: path(entry.path), winningSource: source(entry.winningSourceId),
      overriddenSources: entry.overriddenSourceIds.map(source), redacted: entry.redacted === true })),
    issues: report.issues.map(entry => ({ category: CATEGORIES.includes(entry.category) ? entry.category : "other",
      severity: entry.severity === "warning" ? "warning" : "error",
      ...(entry.sourceId === undefined ? {} : { source: source(entry.sourceId) }),
      ...(entry.path === undefined ? {} : { path: path(entry.path) }) })),
    provenance: report.provenance.map(entry => ({ action: ACTIONS.includes(entry.action) ? entry.action : "other",
      source: source(entry.sourceId), path: path(entry.path),
      ...(entry.previousSourceId === undefined ? {} : { previousSource: source(entry.previousSourceId) }) }))
  };
  if (new TextEncoder().encode(JSON.stringify(projected)).byteLength <= report.limits.maxReportBytes) return projected;
  return { schemaVersion: "public-diagnostic-1", status: "error", sources: [], resolvedPaths: [], issues: [], provenance: [], truncated: true };
}
