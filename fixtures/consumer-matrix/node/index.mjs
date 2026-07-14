import { resolveConfig } from "@0disoft/universal-config-engine-core";
import { createProcessEnvSource } from "@0disoft/universal-config-engine-node";

const source = createProcessEnvSource({
  descriptor: { id: "env", kind: "process-env", priority: 10, displayName: "env" },
  env: { APP_PORT: "8080" },
  mappings: [{
    externalName: "APP_PORT",
    sourceKind: "process-env",
    targetPath: ["service", "port"],
    parseAs: "number"
  }]
});
const result = resolveConfig({ sources: [source] });

if (!result.ok || result.config.service.port !== 8080) {
  throw new Error("Node adapter consumer failed.");
}
