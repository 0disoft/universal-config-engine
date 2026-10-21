import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPublicDiagnosticReport, createStandardSchemaValidator, runConfigPipeline, runValidatedConfigPipeline } from "@0disoft/universal-config-engine-core";
import { createConfigReloader, watchConfigFiles } from "@0disoft/universal-config-engine-node";
import { createDeclaredValidators, loadDeclaredSources, loadPipelineDeclarationContext } from "@0disoft/universal-config-engine-cli";

const workspace = dirname(fileURLToPath(import.meta.url));
async function input() {
  const context = await loadPipelineDeclarationContext("uce.json", workspace, { workspacePath: workspace, profile: "production" });
  const sources = await loadDeclaredSources({ ...context, configPath: context.canonicalConfigPath, cwd: workspace, env: process.env, argv: [] });
  const declared = createDeclaredValidators(context.declaration);
  if (declared.issues.length > 0) throw new Error("Example validator setup failed.");
  return { context: undefined, validators: declared.validators, loaders: sources.map(source => ({
    descriptor: source.descriptor, load: () => source
  })) };
}
const outputValidator = createStandardSchemaValidator({ schema: { "~standard": { version: 1, vendor: "adoption-example",
  validate(value) { return { value: { listenPort: value.server.port } }; }
} } });
const typed = await runValidatedConfigPipeline({ ...await input(), outputValidator });
if (!typed.ok || typeof typed.value.listenPort !== "number") throw new Error("Example typed validation failed.");
// typed.value is private application data. Only project diagnostics for sharing.
const load = async () => runConfigPipeline(await input());
const reloader = createConfigReloader({ load });
try {
  if (!(await reloader.refresh()).ok) throw new Error("Example reload failed.");
} finally { reloader.close(); }

const watched = await watchConfigFiles({ workspacePath: workspace,
  paths: ["uce.json", "common/base.json", "common/settings.yaml", "common/production.toml"], load });
if (!watched.ok) throw new Error("Example watcher setup failed.");
try {
  if (!watched.initial.ok) throw new Error("Example initial snapshot failed.");
  // In a long-running app, retain this handle and close it during shutdown.
} finally { watched.watcher.close(); }
console.log(JSON.stringify({ typed: "valid", reload: "ready", watch: "closed",
  publicReport: buildPublicDiagnosticReport(typed.report) }));
