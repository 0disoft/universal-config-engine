import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { findSecretSnapshotViolations } from "./check-no-secret-snapshots.mjs";

test("reports secret markers only from snapshot and fixture files", () => {
  const root = mkdtempSync(join(tmpdir(), "uce-secret-scan-"));
  try {
    write(root, "packages/core/test/fixtures/leaked.md", "-----BEGIN PRIVATE KEY-----\n");
    write(root, "packages/core/test/fixtures/safe.json", "{}\n");
    write(root, "packages/core/test/ordinary.md", "-----BEGIN PRIVATE KEY-----\n");
    write(root, "packages/core/dist/fixtures/generated.md", "-----BEGIN PRIVATE KEY-----\n");

    assert.deepEqual(findSecretSnapshotViolations({ root }), [
      "packages/core/test/fixtures/leaked.md"
    ]);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("returns no violations for safe fixtures", () => {
  const root = mkdtempSync(join(tmpdir(), "uce-secret-scan-"));
  try {
    write(root, "packages/core/test/fixtures/config.json", "{\"safe\":true}\n");
    assert.deepEqual(findSecretSnapshotViolations({ root }), []);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

function write(root, relativePath, content) {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}
