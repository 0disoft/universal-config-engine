import { closeSync, fstatSync, openSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const highRiskPatterns = [
  /sk_(live|proj)_[A-Za-z0-9_-]+/,
  new RegExp("A" + "KIA[0-9A-Z]{16}"),
  new RegExp("g" + "hp_[A-Za-z0-9_]{20,}"),
  /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/,
  /password\s*[:=]\s*["']?[^"'\s]+/i,
  /token\s*[:=]\s*["']?[^"'\s]+/i,
  /secret\s*[:=]\s*["']?[^"'\s]+/i
];
const scannedExtensions = new Set([".json", ".md", ".snap"]);
const ignoredDirectories = new Set(["node_modules", "dist", "coverage", ".git"]);

export function findSecretSnapshotViolations({
  root = process.cwd(),
  scannedRoots = ["packages"]
} = {}) {
  const violations = [];

  for (const scannedRoot of scannedRoots) {
    walkDirectory(join(root, scannedRoot), root, violations);
  }

  return violations;
}

function walkDirectory(directory, root, violations) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      continue;
    }

    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        walkDirectory(path, root, violations);
      }
      continue;
    }

    if (!entry.isFile() || !hasScannedExtension(path) || !isSnapshotOrFixture(path)) {
      continue;
    }

    const content = readRegularFile(path);
    if (content === undefined) {
      continue;
    }

    for (const pattern of highRiskPatterns) {
      if (pattern.test(content)) {
        violations.push(relative(root, path).replaceAll("\\", "/"));
        break;
      }
    }
  }
}

function readRegularFile(path) {
  const descriptor = openSync(path, "r");
  try {
    if (!fstatSync(descriptor).isFile()) {
      return undefined;
    }
    return readFileSync(descriptor, "utf8");
  } finally {
    closeSync(descriptor);
  }
}

function hasScannedExtension(path) {
  return scannedExtensions.has(path.slice(path.lastIndexOf(".")));
}

function isSnapshotOrFixture(path) {
  const normalized = path.replaceAll("\\", "/");
  return normalized.includes("/__snapshots__/") || normalized.includes("/fixtures/");
}

function main() {
  const violations = findSecretSnapshotViolations();
  if (violations.length === 0) {
    return;
  }

  console.error("Potential raw secret values found:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  main();
}
