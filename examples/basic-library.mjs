import {
  runConfigPipeline
} from "@0disoft/universal-config-engine-core";

const { result, report } = await runConfigPipeline({
  loaders: [
    {
      descriptor: {
        id: "defaults",
        kind: "object",
        priority: 0,
        displayName: "defaults"
      },
      load() {
        return {
          value: {
            service: {
              host: "127.0.0.1",
              port: 3000
            }
          }
        };
      }
    },
    {
      descriptor: {
        id: "local",
        kind: "object",
        priority: 10,
        displayName: "local"
      },
      load() {
        return {
          value: {
            service: {
              port: 8080
            }
          }
        };
      }
    }
  ],
  context: undefined
});

process.stdout.write(`${JSON.stringify({
  status: report.status,
  port: result.config.service.port,
  winningSourceId: report.resolvedPaths.find(
    (entry) => entry.path.join(".") === "service.port"
  )?.winningSourceId
})}\n`);
