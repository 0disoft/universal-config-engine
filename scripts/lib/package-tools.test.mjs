import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { npmCompatibleEnvironment, withWorkspaceSmoke } from "./package-tools.mjs";
import { WORKSPACE_PACKAGE_NAMES, packageDirectory } from "./workspace-packages.mjs";

test("the shared package catalog covers publishable manifests in dependency order", () => {
  const packageRoot = new URL("../../packages/", import.meta.url);
  const manifests = readdirSync(packageRoot).map((directory) =>
    JSON.parse(readFileSync(new URL(`${directory}/package.json`, packageRoot), "utf8"))
  ).filter((manifest) => !manifest.private);
  assert.deepEqual(new Set(WORKSPACE_PACKAGE_NAMES), new Set(manifests.map((manifest) => manifest.name)));
  const seen = new Set();
  for (const name of WORKSPACE_PACKAGE_NAMES) {
    const manifest = manifests.find((entry) => entry.name === name);
    assert.deepEqual(manifest, JSON.parse(readFileSync(new URL(`${packageDirectory(name)}/package.json`, packageRoot), "utf8")));
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      if (WORKSPACE_PACKAGE_NAMES.includes(dependency)) assert(seen.has(dependency), `${dependency} must precede ${name}`);
    }
    seen.add(name);
  }
});

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
