import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { npmCompatibleEnvironment, withWorkspaceSmoke } from "./package-tools.mjs";

for (const fails of [false, true]) {
  test(`smoke cleanup preserves unrelated files after ${fails ? "failure" : "success"}`, async () => {
    const root = mkdtempSync(join(tmpdir(), "uce-smoke-cleanup-test-"));
    let scratch;
    try {
      const releaseDir = join(root, ".tmp", "release");
      mkdirSync(releaseDir, { recursive: true });
      const sentinel = join(releaseDir, "keep.txt");
      writeFileSync(sentinel, "unrelated release artifact");
      const run = withWorkspaceSmoke(root, async ({ packDir, consumerDir }) => {
        scratch = dirname(packDir);
        writeFileSync(join(packDir, "package.tgz"), "temporary tarball");
        writeFileSync(join(consumerDir, "package.json"), "{}");
        const dist = join(root, "packages", "core", "dist");
        mkdirSync(dist, { recursive: true });
        writeFileSync(join(dist, "index.js"), "temporary build");
        if (fails) throw new Error("simulated smoke failure");
        return "complete";
      });
      if (fails) await assert.rejects(run, /simulated smoke failure/);
      else assert.equal(await run, "complete");
      assert.equal(existsSync(scratch), false);
      assert.equal(existsSync(join(root, "packages", "core", "dist")), false);
      assert.equal(readFileSync(sentinel, "utf8"), "unrelated release artifact");
    } finally {
      // root is the exact directory returned by mkdtempSync above.
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("npm receives its compatible environment without changing the caller's environment", () => {
  const input = { PATH: "keep", npm_config_manage_package_manager_versions: "true", NPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS: "true" };
  assert.deepEqual(npmCompatibleEnvironment(input), { PATH: "keep" });
  assert.equal(input.npm_config_manage_package_manager_versions, "true");
  assert.equal(input.NPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS, "true");
});
