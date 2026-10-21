import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { discoverPipelineDeclaration, loadConfigFileSource } from "@0disoft/universal-config-engine-node";
import { resolveConfig } from "@0disoft/universal-config-engine-core";

const packageRoot = join(process.cwd(), "node_modules/@0disoft/universal-config-engine-cli");
const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
for (const [format, text] of [
  ["jsonc", '{/* file */ "port":80,"password":"UCE_FILE_CONSUMER_PRIVATE"}'],
  ["yaml", "port: 80\npassword: UCE_FILE_CONSUMER_PRIVATE\n"],
  ["toml", 'port = 80\npassword = "UCE_FILE_CONSUMER_PRIVATE"\n'],
  ["json5", "{port:80,password:'UCE_FILE_CONSUMER_PRIVATE',}" ]
]) {
  const filePath = join(process.cwd(), `settings.${format}`);
  writeFileSync(filePath, text);
  const loaded = await loadConfigFileSource({
    descriptor: { id: "file", kind: "adapter", priority: 1, displayName: "file" }, filePath, format
  });
  assert.equal(resolveConfig({ sources: [loaded] }).ok, true);
  const declaration = `pipeline-${format}.json`;
  writeFileSync(declaration, JSON.stringify({ sources: [
    { id: "file", kind: "adapter", format, priority: 1, path: `settings.${format}` }
  ] }));
  const output = execFileSync(process.execPath, [join(packageRoot, manifest.bin.uce),
    "explain", "--config", declaration, "--values", "--json"], { encoding: "utf8", timeout: 30000 });
  const report = JSON.parse(output);
  assert.equal(report.status, "ok");
  assert(report.entries.some(entry => entry.path[0] === "port" && entry.value === 80));
  assert(!output.includes("UCE_FILE_CONSUMER_PRIVATE"));
}
const workspace = join(process.cwd(), "discovery-project");
mkdirSync(workspace);
writeFileSync(join(workspace, "uce.json"), JSON.stringify({ sources: [
  { id: "defaults", kind: "object", priority: 0, value: { port: 8080 } }
] }));
assert.equal((await discoverPipelineDeclaration({ workspacePath: workspace })).ok, true);
const selected = JSON.parse(execFileSync(process.execPath, [join(packageRoot, manifest.bin.uce),
  "validate", "--discover", workspace, "--json"], { encoding: "utf8", timeout: 30000 }));
assert.equal(selected.status, "ok");
console.log("Installed Node/CLI file formats and workspace discovery passed (4 dialects).");
