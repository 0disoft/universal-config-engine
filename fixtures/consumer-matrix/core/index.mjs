import { runConfigPipeline } from "@0disoft/universal-config-engine-core";

const pipeline = await runConfigPipeline({
  loaders: [{
    descriptor: { id: "defaults", kind: "object", priority: 0, displayName: "defaults" },
    load() {
      return { value: { service: { port: 8080 } } };
    }
  }],
  context: undefined
});

if (!pipeline.result.ok || pipeline.report.schemaVersion !== "0.2") {
  throw new Error("Core JavaScript consumer failed.");
}
