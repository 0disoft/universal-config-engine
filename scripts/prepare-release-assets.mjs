import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_PACKAGE_NAMES, packageTarballName } from "./lib/workspace-packages.mjs";
import { parseReleaseVersion } from "./release-version.mjs";
import { readJson } from "./lib/http-read.mjs";

export function planReleaseAssets(version, release) {
  const parsed = parseReleaseVersion(version);
  const names = WORKSPACE_PACKAGE_NAMES.map((name) => packageTarballName(name, version));
  if (release === undefined) return { reuse: [], upload: names };
  if (release.tag_name !== `v${version}` || release.draft !== false || release.prerelease !== parsed.prerelease || !Array.isArray(release.assets)) {
    throw new Error("Existing GitHub release does not match the requested published release.");
  }
  const reuse = [];
  const upload = [];
  for (const name of names) {
    const matches = release.assets.filter((asset) => asset.name === name);
    if (matches.length > 1 || (matches.length === 1 && (!Number.isSafeInteger(matches[0].size) || matches[0].size <= 0))) {
      throw new Error(`Existing release asset is ambiguous or empty: ${name}.`);
    }
    (matches.length === 1 ? reuse : upload).push(name);
  }
  return { reuse, upload };
}

function runGh(args) {
  execFileSync("gh", args, { stdio: "inherit", timeout: 120_000 });
}

export function prepareReleaseAssets({ version, repository, packDir, notesFile, release, publishedPackageNames = [], run = runGh }) {
  const plan = planReleaseAssets(version, release);
  const tag = `v${version}`;
  for (const name of publishedPackageNames) {
    if (plan.upload.includes(packageTarballName(name, version))) {
      throw new Error(`Published npm package is missing its original GitHub asset: ${name}. Restore the verified npm bytes before retrying.`);
    }
  }
  if (plan.reuse.length > 0) {
    // Replace only the local repack. The original GitHub bytes become the input
    // for any still-missing npm publication in this attempt.
    run(["release", "download", tag, "--repo", repository, "--dir", packDir, "--clobber",
      ...plan.reuse.flatMap((name) => ["--pattern", name])]);
  }
  for (const name of [...plan.reuse, ...plan.upload]) {
    const file = statSync(join(packDir, name));
    if (!file.isFile() || file.size === 0) throw new Error(`Missing or empty release tarball: ${name}.`);
    const previous = release?.assets.find((asset) => asset.name === name);
    if (previous !== undefined && file.size !== previous.size) throw new Error(`Downloaded release asset size mismatch: ${name}.`);
  }
  if (release === undefined) {
    const args = ["release", "create", tag, ...plan.upload.map((name) => join(packDir, name)),
      "--repo", repository, "--verify-tag", "--title", tag, "--notes-file", notesFile];
    if (parseReleaseVersion(version).prerelease) args.push("--prerelease");
    run(args);
  } else if (plan.upload.length > 0) {
    // No --clobber: an unexpected concurrent upload must fail rather than mutate
    // an artifact that may already have been published to npm.
    run(["release", "upload", tag, ...plan.upload.map((name) => join(packDir, name)), "--repo", repository]);
  }
  return plan;
}

export async function lookupRelease(repository, version, token, fetchImpl = fetch) {
  return readJson(`https://api.github.com/repos/${repository}/releases/tags/v${version}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    fetchImpl, allowNotFound: true
  });
}

async function main() {
  const version = process.env.RELEASE_VERSION;
  parseReleaseVersion(version);
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GH_TOKEN;
  const notesFile = process.env.RELEASE_NOTES_FILE;
  const stateFile = process.env.PUBLICATION_STATE_FILE;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "") || !token || !notesFile || !stateFile) {
    throw new Error("Release assets require GITHUB_REPOSITORY, GH_TOKEN, RELEASE_NOTES_FILE and PUBLICATION_STATE_FILE.");
  }
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  if (state.releaseVersion !== version || state.phase !== "before" || !Array.isArray(state.packages)) {
    throw new Error("Release assets require the matching before-publication state.");
  }
  const publishedPackageNames = state.packages.filter((entry) => entry.status === "published").map((entry) => entry.name);
  const release = await lookupRelease(repository, version, token);
  const plan = prepareReleaseAssets({ version, repository, packDir: ".tmp/release", notesFile, release, publishedPackageNames });
  console.log(`Release assets: ${plan.reuse.length} original tarballs reused, ${plan.upload.length} new tarballs uploaded.`);
}

if (process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
