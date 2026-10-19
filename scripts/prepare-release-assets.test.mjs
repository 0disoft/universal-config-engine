import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { lookupRelease, planReleaseAssets, prepareReleaseAssets } from "./prepare-release-assets.mjs";
import { WORKSPACE_PACKAGE_NAMES } from "./lib/workspace-packages.mjs";

const names = planReleaseAssets("1.0.1").upload;
const original = "original published bytes";
function published(assets = names) {
  return { tag_name: "v1.0.1", draft: false, prerelease: false, assets: assets.map((name) => ({ name, size: Buffer.byteLength(original) })) };
}

test("retry restores original files before filling missing assets, without clobbering remote artifacts", () => {
  const packDir = mkdtempSync(join(tmpdir(), "uce-release-assets-"));
  try {
    for (const name of names) writeFileSync(join(packDir, name), "different repack bytes");
    const calls = [];
    const release = published(names.slice(0, -1));
    release.assets.push({ name: "publication-state-before.json", size: 20 });
    const plan = prepareReleaseAssets({ version: "1.0.1", repository: "0disoft/universal-config-engine", packDir, release,
      run(args) {
        calls.push(args);
        if (args[1] === "download") {
          for (const name of names.slice(0, -1)) writeFileSync(join(packDir, name), original);
        } else {
          for (const name of names.slice(0, -1)) assert.equal(readFileSync(join(packDir, name), "utf8"), original);
        }
      }
    });
    assert.deepEqual(plan.reuse, names.slice(0, -1));
    assert.deepEqual(plan.upload, names.slice(-1));
    assert.equal(calls.length, 2);
    assert.equal(calls[1][1], "upload");
    assert.equal(basename(calls[1][3]), names.at(-1));
    assert(!calls[1].includes("--clobber"));
    assert.equal(readFileSync(join(packDir, names.at(-1)), "utf8"), "different repack bytes");
  } finally {
    rmSync(packDir, { recursive: true, force: true });
  }
});

test("a complete retry only downloads originals and leaves the remote release unchanged", () => {
  assert.deepEqual(planReleaseAssets("1.0.1", published()), { reuse: names, upload: [] });
  const packDir = mkdtempSync(join(tmpdir(), "uce-release-assets-"));
  try {
    const calls = [];
    prepareReleaseAssets({ version: "1.0.1", repository: "owner/repo", packDir, release: published(), run(args) {
      calls.push(args);
      for (const name of names) writeFileSync(join(packDir, name), original);
    } });
    assert.deepEqual(calls.map((args) => args[1]), ["download"]);
  } finally {
    rmSync(packDir, { recursive: true, force: true });
  }
});

test("first publication creates a release from all tarballs and enforces prerelease status", () => {
  const packDir = mkdtempSync(join(tmpdir(), "uce-release-assets-"));
  try {
    const version = "1.0.1-rc.1";
    for (const name of planReleaseAssets(version).upload) writeFileSync(join(packDir, name), original);
    const calls = [];
    prepareReleaseAssets({ version, repository: "owner/repo", packDir, notesFile: "notes.md", run: (args) => calls.push(args) });
    assert.equal(calls[0][1], "create");
    assert(calls[0].includes("--verify-tag"));
    assert(calls[0].includes("--prerelease"));
    assert(!calls[0].includes("--clobber"));
    writeFileSync(join(packDir, planReleaseAssets(version).upload[0]), "");
    assert.throws(() => prepareReleaseAssets({ version, repository: "owner/repo", packDir }), /empty release tarball/);
  } finally {
    rmSync(packDir, { recursive: true, force: true });
  }
});

test("mismatched, draft, duplicate and empty existing artifacts fail closed", () => {
  for (const release of [
    { ...published(), tag_name: "v1.0.0" }, { ...published(), draft: true }, { ...published(), prerelease: true },
    { ...published(), assets: [{ name: names[0], size: 0 }] },
    { ...published(), assets: [published().assets[0], published().assets[0]] }
  ]) assert.throws(() => planReleaseAssets("1.0.1", release));
});

test("a missing asset for an already published npm package cannot be replaced by a repack", () => {
  assert.throws(() => prepareReleaseAssets({ version: "1.0.1", repository: "owner/repo", packDir: ".",
    release: published(names.slice(1)), publishedPackageNames: [WORKSPACE_PACKAGE_NAMES[0]],
    run() { assert.fail("Must not mutate assets before checking publication state"); }
  }), /missing its original GitHub asset/);
});

test("only GitHub 404 permits creation; permission and service failures block it", async () => {
  assert.equal(await lookupRelease("owner/repo", "1.0.1", "", async () => new Response("", { status: 404 })), undefined);
  for (const status of [401, 403, 500]) {
    await assert.rejects(lookupRelease("owner/repo", "1.0.1", "", async () => new Response("", { status })), new RegExp(`HTTP ${status}`));
  }
});
