import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyNpmViewResult,
  collectPublicationState,
  RELEASE_PACKAGE_NAMES
} from "./record-publication-state.mjs";

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
