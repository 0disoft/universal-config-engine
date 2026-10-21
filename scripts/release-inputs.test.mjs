import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const step = workflow.split("      - name: Resolve release inputs")[1].split("      - name: Checkout")[0];
const script = step.split("        run: |\n")[1].split("\n").map(line => line.replace(/^          /, "")).join("\n");

test("release dispatch inputs cross the shell boundary only through environment variables", () => {
  assert.match(step, /RELEASE_TAG_INPUT: \$\{\{ inputs.tag \}\}/);
  assert.match(step, /RELEASE_DRY_RUN_INPUT: \$\{\{ inputs.dry_run \}\}/);
  assert.doesNotMatch(script, /\$\{\{/);
});

test("release inputs reject shell text without execution and preserve valid release modes", () => {
  const directory = mkdtempSync(join(tmpdir(), "uce-release-inputs-"));
  const output = join(directory, "output").replaceAll("\\", "/");
  const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
  function run(tag, dryRun, event = "workflow_dispatch") {
    return spawnSync(bash, ["-c", script], { encoding: "utf8", env: { ...process.env,
      GITHUB_EVENT_NAME: event, GITHUB_REF_NAME: "v1.2.0", GITHUB_SHA: "commit-sha",
      GITHUB_OUTPUT: output, RELEASE_TAG_INPUT: tag, RELEASE_DRY_RUN_INPUT: dryRun } });
  }
  try {
    const invalid = run("v1.2.0$(printf UCE_SHELL_EXECUTED >&2)", "true");
    assert.ifError(invalid.error);
    assert.equal(invalid.status, 1);
    // The validation error can quote the literal input; a separate marker line would mean execution.
    assert.doesNotMatch(invalid.stderr, /^UCE_SHELL_EXECUTED$/m);
    assert.equal(run("v1.3.0-rc.1", "true").status, 0);
    assert.match(readFileSync(output, "utf8"), /npm_tag=next\ndry_run=true\ncheckout_ref=commit-sha/);
    assert.equal(run("v1.3.0", "false").status, 0);
    assert.match(readFileSync(output, "utf8"), /npm_tag=latest\ndry_run=false\ncheckout_ref=v1.3.0/);
    assert.equal(run("ignored", "true", "push").status, 0);
    assert.match(readFileSync(output, "utf8"), /checkout_ref=v1.2.0/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
