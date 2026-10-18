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
}
