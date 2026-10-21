import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfigFileSource } from "@0disoft/universal-config-engine-node";
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
console.log("Installed Node/CLI file formats passed (4 dialects).");
