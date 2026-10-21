import { buildPublicDiagnosticReport, type DiagnosticReport } from "@0disoft/universal-config-engine-core";

export function formatPublicReport(report: DiagnosticReport) {
  const projected = buildPublicDiagnosticReport(report);
  return { output: `${JSON.stringify(projected, null, 2)}\n`, status: projected.status };
}
