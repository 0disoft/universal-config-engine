import {
  runConfigPipeline,
  type ConfigLoader,
  type RunConfigPipelineResult
} from "@0disoft/universal-config-engine-core";

const loader: ConfigLoader = {
  descriptor: {
    id: "typed-defaults",
    kind: "object",
    priority: 0,
    displayName: "typed-defaults"
  },
  load() {
    return { value: { enabled: true } };
  }
};

const pipeline: RunConfigPipelineResult = await runConfigPipeline({
  loaders: [loader],
  context: undefined
});

if (!pipeline.result.ok || pipeline.report.schemaVersion !== "0.2") {
  throw new Error("Core strict TypeScript consumer failed.");
}
