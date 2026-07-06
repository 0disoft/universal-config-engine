import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const scannedRoots = ["packages"];
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
const violations = [];

for (const scannedRoot of scannedRoots) {
  walk(join(root, scannedRoot));
}

if (violations.length > 0) {
  console.error("Potential raw secret values found:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

function walk(path) {
  const stats = statSync(path);
  if (stats.isDirectory()) {
    const name = path.split(/[\\/]/).at(-1);
    if (ignoredDirectories.has(name)) {
      return;
    }
    for (const child of readdirSync(path)) {
      walk(join(path, child));
    }
    return;
  }

  if (!stats.isFile() || !hasScannedExtension(path)) {
    return;
  }

  if (!isSnapshotOrFixture(path)) {
    return;
  }

  const content = readFileSync(path, "utf8");
  for (const pattern of highRiskPatterns) {
    if (pattern.test(content)) {
      violations.push(relative(root, path));
      break;
    }
  }
}

function hasScannedExtension(path) {
  return scannedExtensions.has(path.slice(path.lastIndexOf(".")));
}

function isSnapshotOrFixture(path) {
  const normalized = path.replaceAll("\\", "/");
  return normalized.includes("/__snapshots__/") || normalized.includes("/fixtures/");
}
