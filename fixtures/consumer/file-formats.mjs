import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
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
for (const [format, text, line, column, reason] of [
  ["yaml", "UCE_PRIVATE_KEY: UCE_PRIVATE_VALUE\nUCE_PRIVATE_KEY: other\n", 2, 1, "duplicate-key"],
  ["toml", 'password = "UCE_PRIVATE_VALUE"\nvalue = @\n', 2, 9, "syntax"],
  ["json5", "{\n password:'UCE_PRIVATE_VALUE',\n value:@\n}", 3, 8, "syntax"]
]) {
  writeFileSync(join(process.cwd(), `settings.${format}`), text);
  const loaded = await loadConfigFileSource({ descriptor: { id: "file", kind: "adapter", priority: 1, displayName: "file" },
    filePath: join(process.cwd(), `settings.${format}`), format });
  assert.deepEqual(loaded.issues[0].details, { format, reason, line, column });
  for (const flags of [[], ["--json"]]) {
    const result = spawnSync(process.execPath, [join(packageRoot, manifest.bin.uce),
      "validate", "--config", `pipeline-${format}.json`, ...flags], { encoding: "utf8", timeout: 30000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 2);
    assert(!`${result.stdout}${result.stderr}`.includes("UCE_PRIVATE"));
    if (flags.length === 0) assert(result.stdout.includes(`line ${line}, column ${column}`));
    else assert.deepEqual(JSON.parse(result.stdout).issues[0].details, { format, reason, line, column });
  }
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
mkdirSync(join(workspace, "service"));
writeFileSync(join(workspace, "base.json"), JSON.stringify({ sources: [], profiles: { production: {
  sources: [{ id: "production", kind: "adapter", format: "yaml", priority: 10, path: "prod.yaml" }]
} } }));
writeFileSync(join(workspace, "prod.yaml"), "port: 443\npassword: UCE_PROFILE_PRIVATE\n");
writeFileSync(join(workspace, "service/uce.json"), JSON.stringify({ sources: [], extends: ["../base.json"] }));
const profiledText = execFileSync(process.execPath, [join(packageRoot, manifest.bin.uce), "explain",
  "--config", join(workspace, "service/uce.json"), "--workspace", workspace, "--profile", "production", "--values", "--json"],
  { encoding: "utf8", timeout: 30000 });
const profiled = JSON.parse(profiledText);
assert.equal(profiled.status, "ok");
assert(profiled.entries.some(entry => entry.path[0] === "port" && entry.value === 443));
assert(!profiledText.includes("UCE_PROFILE_PRIVATE"));
console.log("Installed Node/CLI formats, discovery, profiles and inheritance passed.");
