import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const cwd = process.cwd();
const cli = join(cwd, "node_modules/@0disoft/universal-config-engine-cli/dist/main.js");
const env = { ...process.env, APP_PORT: "9443" };
const invoke = args => JSON.parse(execFileSync(process.execPath, [cli, ...args], { cwd, env, encoding: "utf8", timeout: 30000 }));
mkdirSync(join(cwd, "initialized"));
assert.equal(invoke(["init", "--directory", "initialized", "--json"]).status, "created");
assert.equal(invoke(["doctor", "--config", "initialized/uce.json", "--json"]).status, "ok");
const baseArgs = ["--config", "adoption/uce.json", "--workspace", "adoption", "--profile", "production"];
const inspected = invoke(["explain", ...baseArgs, "--values", "--json"]);
assert(inspected.entries.some(entry => entry.path.join(".") === "server.port" && entry.value === 9443 && entry.source?.winningSourceId === "deployment-env"));
const shared = invoke(["doctor", ...baseArgs, "--public"]);
assert.equal(shared.schemaVersion, "public-diagnostic-1");
assert(!JSON.stringify(shared).includes("deployment-env"));
const library = JSON.parse(execFileSync(process.execPath, [join(cwd, "adoption/library.mjs")], { cwd, env, encoding: "utf8", timeout: 30000 }));
assert.deepEqual([library.typed, library.reload, library.watch], ["valid", "ready", "closed"]);

// The reproducible comparison case is executed against the actual installed CLI.
const policy = spawnSync(process.execPath, [cli, "diff", "--config", "comparison/before.json", "--against", "comparison/after.json", "--policy", "comparison/policy.json", "--json"],
  { cwd, env, encoding: "utf8", timeout: 30000 });
assert.equal(policy.status, 3);
const change = JSON.parse(policy.stdout);
assert.equal(change.status, "error");
assert.equal(change.policy.violations.length, 3);
const expected = ["stable-port", "required-enabled", "defaults-only"].sort();
assert.deepEqual(change.policy.violations.map(entry => entry.ruleId).sort(), expected);
console.log("Installed adoption workflow passed: initialization, profiles, provenance, doctor/public reports, typed output, reload/watch disposal and three CI violations.");
