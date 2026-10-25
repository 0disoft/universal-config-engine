import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPublicDiagnosticReport, createStandardSchemaValidator } from "@0disoft/universal-config-engine-core";
import { createConfigReloader, watchConfig, loadConfig, loadValidatedConfig } from "@0disoft/universal-config-engine-node";
import { createAjvValidator } from "@0disoft/universal-config-engine-validator-ajv";

const workspace = dirname(fileURLToPath(import.meta.url));
const options = { configPath: "uce.json", cwd: workspace, workspacePath: workspace,
  profile: "production", env: process.env, argv: [], validatorFactory: createAjvValidator };
const outputValidator = createStandardSchemaValidator({ schema: { "~standard": { version: 1, vendor: "adoption-example",
  validate(value) { return { value: { listenPort: value.server.port } }; }
} } });
const typed = await loadValidatedConfig({ ...options, outputValidator });
if (!typed.ok || typeof typed.value.listenPort !== "number") throw new Error("Example typed validation failed.");
// typed.value is private application data. Only project diagnostics for sharing.
const load = operation => loadConfig({ ...options, ...operation });
const reloader = createConfigReloader({ load });
try {
  if (!(await reloader.refresh()).ok) throw new Error("Example reload failed.");
} finally { reloader.close(); }

// Declaration, inheritance and selected file sources are tracked automatically.
const watched = await watchConfig(options);
if (!watched.ok) throw new Error("Example watcher setup failed.");
try {
  if (!watched.initial.ok) throw new Error("Example initial snapshot failed.");
  // In a long-running app, retain this handle and close it during shutdown.
} finally { watched.watcher.close(); }
console.log(JSON.stringify({ typed: "valid", reload: "ready", watch: "closed",
  publicReport: buildPublicDiagnosticReport(typed.report) }));
