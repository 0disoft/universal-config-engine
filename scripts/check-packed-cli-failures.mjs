import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

// Resolve the installed package's declared executable, avoiding shell shims and workspace links.
export function checkPackedCliFailures(directory) {
  const packageRoot = join(directory, "node_modules", "@0disoft", "universal-config-engine-cli");
  const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  const executable = realpathSync(resolve(packageRoot, manifest.bin.uce));
  const installedPath = relative(realpathSync(directory), executable);
  assert(!isAbsolute(installedPath) && !installedPath.startsWith(".."),
    "CLI failure smoke must execute the isolated installed package.");

  const sentinel = "UCE_PACKED_FAILURE_PRIVATE_SENTINEL";
  writeFileSync(join(directory, "oversized.json"),
    JSON.stringify({ padding: sentinel + "x".repeat(1024 * 1024) }));

  const cases = [
    { args: ["explain"], exitCode: 4, stderr: "Missing required --config path.\n" },
    { args: ["validate", "--json"], exitCode: 4, category: "usage", code: "cli_usage_error" },
    { args: ["explain", "--config", "not-present.json", "--json"],
      exitCode: 2, category: "source-load", code: "pipeline_declaration_load_failed" },
    { args: ["explain", "--config", "oversized.json", "--json"],
      exitCode: 3, category: "resource-limit", code: "max_file_bytes_exceeded" }
  ];
  for (const scenario of cases) {
    const result = spawnSync(process.execPath, [executable, ...scenario.args], {
      cwd: directory, encoding: "utf8", maxBuffer: 64 * 1024, timeout: 30_000
    });
    assert(!result.error && result.signal === null, "Installed CLI must terminate normally.");
    assert.equal(result.status, scenario.exitCode, "Installed CLI exit code differs from its contract.");
    for (const output of [result.stdout, result.stderr]) {
      assert(Buffer.byteLength(output) < 8192, "CLI failure output must remain bounded.");
      assert(!output.includes(sentinel), "CLI failure output exposed the input sentinel.");
    }
    if (scenario.stderr !== undefined) {
      assert.equal(result.stdout, "", "Usage failure must leave stdout empty.");
      assert.equal(result.stderr.replaceAll("\r\n", "\n"), scenario.stderr);
    } else {
      assert.equal(result.stderr, "", "JSON failure must leave stderr empty.");
      const report = JSON.parse(result.stdout);
      assert.equal(report.schemaVersion, "0.2");
      assert.equal(report.status, "error");
      assert.equal(report.command, scenario.args[0]);
      assert(report.issues.some((issue) =>
        issue.category === scenario.category && issue.code === scenario.code));
    }
  }
  process.stdout.write("Installed CLI failure paths passed (4 cases).\n");
  checkPackedInspection(executable, directory);
}

function checkPackedInspection(executable, directory) {
  const sentinel = "UCE_PACKED_INSPECTION_PRIVATE_SENTINEL";
  const declaration = (port, value) => ({ sources: [{ id: "defaults", kind: "object", priority: 0,
    value: { service: { port, password: value } } }] });
  writeFileSync(join(directory, "before.json"), JSON.stringify(declaration(80, sentinel)));
  writeFileSync(join(directory, "after.json"), JSON.stringify(declaration(443, sentinel + "changed")));
  writeFileSync(join(directory, "policy.json"), JSON.stringify({ version: "change-policy-1", rules: [
    { id: "stable-port", path: ["service", "port"], mode: "forbid-changes" }
  ] }));
  writeFileSync(join(directory, "invalid-policy.json"), JSON.stringify({ version: "unknown" }));
  const scenarios = [
    { args: ["explain", "--config", "before.json", "--values"], version: "inspection-1", exit: 0 },
    { args: ["explain", "--config", "before.json", "--path", '["service","port"]'], version: "inspection-1", exit: 0 },
    { args: ["explain", "--config", "before.json", "--path", '["missing"]'], version: "inspection-1", exit: 4 },
    { args: ["diff", "--config", "before.json", "--against", "after.json"], version: "diff-1", exit: 0 },
    { args: ["diff", "--config", "before.json", "--against", "after.json", "--detect-secret-changes"], version: "diff-1", exit: 0 },
    { args: ["diff", "--config", "before.json", "--against", "after.json", "--policy", "policy.json"], version: "change-check-1", exit: 3 },
    { args: ["diff", "--config", "before.json", "--against", "after.json", "--policy", "invalid-policy.json"], version: "change-check-1", exit: 4 }
  ];
  for (const scenario of scenarios) {
    const execution = spawnSync(process.execPath, [executable, ...scenario.args, "--json"], {
      cwd: directory, encoding: "utf8", maxBuffer: 256 * 1024, timeout: 30_000
    });
    assert(!execution.error && execution.signal === null, "Installed inspection command must terminate normally.");
    assert.equal(execution.status, scenario.exit);
    assert.equal(execution.stderr, "");
    assert(!execution.stdout.includes(sentinel), "Installed value output exposed private input.");
    const report = JSON.parse(execution.stdout);
    assert.equal(report.schemaVersion, scenario.version);
    if (scenario.version === "inspection-1" && scenario.exit === 0) {
      assert(report.entries.some((entry) => JSON.stringify(entry.path) === '["service","port"]' && entry.value === 80));
    }
    if (scenario.version === "diff-1") {
      assert(report.changes.some((change) => change.path.at(-1) === "port" && change.kinds.includes("value-changed")));
      if (scenario.args.includes("--detect-secret-changes")) {
        assert(report.changes.some((change) => change.path.at(-1) === "password" && change.kinds.includes("value-changed")));
      } else assert.deepEqual(report.uncomparedSecretPaths, [["service", "password"]]);
    }
    if (scenario.version === "change-check-1") {
      assert.equal(report.policy.violations[0].code, scenario.exit === 3 ? "change_forbidden" : "invalid_policy");
    }
  }
  process.stdout.write("Installed CLI inspection/diff/policy passed (7 cases).\n");
}
