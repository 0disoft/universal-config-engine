import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyNpmViewResult,
  collectPublicationState,
  RELEASE_PACKAGE_NAMES
} from "./record-publication-state.mjs";
import { parseReleaseVersion } from "./release-version.mjs";

test("collects a bounded package publication summary", () => {
  const manifest = collectPublicationState({
    version: "0.5.0",
    tagName: "v0.5.0",
    commitSha: "abc123",
    workflowRunId: "100",
    workflowRunAttempt: "2",
    phase: "before",
    observedAt: "2026-07-13T00:00:00.000Z",
    lookup(name) {
      return name === RELEASE_PACKAGE_NAMES[0] ? "published" : "missing";
    }
  });

  assert.deepEqual(manifest.summary, {
    total: 5,
    published: 1,
    missing: 4,
    complete: false
  });
  assert.equal(manifest.packages.length, RELEASE_PACKAGE_NAMES.length);
  assert.equal(manifest.packages[0].status, "published");
});

test("distinguishes a missing package from registry lookup failure", () => {
  assert.equal(classifyNpmViewResult({
    status: 1,
    stdout: "",
    stderr: "npm error code E404"
  }, "0.5.0"), "missing");

  assert.throws(() => classifyNpmViewResult({
    status: 1,
    stdout: "",
    stderr: "npm error code EAI_AGAIN"
  }, "0.5.0"), /lookup failed/);
});

test("rejects an unexpected registry version", () => {
  assert.throws(() => classifyNpmViewResult({
    status: 0,
    stdout: '"0.4.0"',
    stderr: ""
  }, "0.5.0"), /unexpected package version/);
});

test("classifies stable and prerelease npm tags", () => {
  assert.deepEqual(parseReleaseVersion("1.0.0"), {
    version: "1.0.0",
    prerelease: false,
    npmTag: "latest"
  });
  assert.deepEqual(parseReleaseVersion("1.0.0-rc.1"), {
    version: "1.0.0-rc.1",
    prerelease: true,
    npmTag: "next"
  });
});

test("rejects partial versions and invalid prerelease identifiers", () => {
  assert.throws(() => parseReleaseVersion("1.0"), /exact stable or prerelease/);
  assert.throws(() => parseReleaseVersion("01.0.0"), /exact stable or prerelease/);
  assert.throws(() => parseReleaseVersion("1.0.0-rc.01"), /leading zeroes/);
  assert.throws(() => parseReleaseVersion("1.0.0-rc+build"), /exact stable or prerelease/);
});
