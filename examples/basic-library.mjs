import {
  buildDiagnosticReport,
  resolveConfig
} from "@0disoft/universal-config-engine-core";

const result = resolveConfig({
  sources: [
    {
      descriptor: {
        id: "defaults",
        kind: "object",
        priority: 0,
        displayName: "defaults"
      },
      value: {
        service: {
          host: "127.0.0.1",
          port: 3000
        }
      }
    },
    {
      descriptor: {
        id: "local",
        kind: "object",
        priority: 10,
        displayName: "local"
      },
      value: {
        service: {
          port: 8080
        }
      }
    }
  ]
});

const report = buildDiagnosticReport(result);
process.stdout.write(`${JSON.stringify({
  status: report.status,
  port: result.config.service.port,
  winningSourceId: report.resolvedPaths.find(
    (entry) => entry.path.join(".") === "service.port"
  )?.winningSourceId
})}\n`);

