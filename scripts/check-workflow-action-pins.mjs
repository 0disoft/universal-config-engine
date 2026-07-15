import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const DOCKER_DIGEST_PATTERN = /@sha256:[0-9a-f]{64}$/i;

export function findWorkflowActionPinViolations(content, path = "workflow.yml") {
  const violations = [];
  const lines = content.split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    const match = line.match(/^\s*(?:-\s*)?uses:\s*(.*?)\s*$/);
    if (!match) {
      continue;
    }

    const reference = parseYamlScalar(match[1]);
    const location = `${path}:${index + 1}`;

    if (!reference) {
      violations.push(`${location} has an empty or unsupported uses reference`);
      continue;
    }

    if (reference.startsWith("./")) {
      continue;
    }

    if (reference.startsWith("docker://")) {
      if (!DOCKER_DIGEST_PATTERN.test(reference)) {
        violations.push(`${location} must pin Docker actions by sha256 digest: ${reference}`);
      }
      continue;
    }

    const revisionSeparator = reference.lastIndexOf("@");
    const actionPath = reference.slice(0, revisionSeparator);
    const revision = reference.slice(revisionSeparator + 1);

    if (
      revisionSeparator <= 0 ||
      !actionPath.includes("/") ||
      !COMMIT_SHA_PATTERN.test(revision)
    ) {
      violations.push(`${location} must pin remote actions to a full commit SHA: ${reference}`);
    }
  }

  return violations;
}

export function scanWorkflowActionPins(workflowDirectory) {
  const workflowFiles = readdirSync(workflowDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  const violations = workflowFiles.flatMap((file) =>
    findWorkflowActionPinViolations(
      readFileSync(resolve(workflowDirectory, file), "utf8"),
      `.github/workflows/${file}`
    )
  );

  return { workflowFiles, violations };
}

function parseYamlScalar(rawValue) {
  const doubleQuoted = rawValue.match(/^"([^"\r\n]+)"\s*(?:#.*)?$/);
  if (doubleQuoted) {
    return doubleQuoted[1];
  }

  const singleQuoted = rawValue.match(/^'([^'\r\n]+)'\s*(?:#.*)?$/);
  if (singleQuoted) {
    return singleQuoted[1];
  }

  return rawValue.replace(/\s+#.*$/, "").trim();
}

function main() {
  const workflowDirectory = resolve(process.cwd(), ".github", "workflows");
  const { workflowFiles, violations } = scanWorkflowActionPins(workflowDirectory);

  if (violations.length > 0) {
    console.error("Mutable or invalid GitHub Actions references found:");
    for (const violation of violations) {
      console.error(`- ${violation}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Verified immutable action pins in ${workflowFiles.length} workflow files.`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  main();
}
