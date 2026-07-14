import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { parseReleaseVersion } from "./release-version.mjs";

export const RELEASE_PACKAGE_NAMES = [
  "@0disoft/universal-config-engine-core",
  "@0disoft/universal-config-engine-node",
  "@0disoft/universal-config-engine-validator-ajv",
  "@0disoft/universal-config-engine-validator-zod",
  "@0disoft/universal-config-engine-cli"
];

export function collectPublicationState(input) {
  const packages = RELEASE_PACKAGE_NAMES.map((name) => ({
    name,
    version: input.version,
    status: input.lookup(name, input.version)
  }));
  const published = packages.filter((entry) => entry.status === "published").length;

  return {
    schemaVersion: "0.1",
    releaseVersion: input.version,
    tagName: input.tagName,
    commitSha: input.commitSha,
    workflowRunId: input.workflowRunId,
    workflowRunAttempt: input.workflowRunAttempt,
    phase: input.phase,
    observedAt: input.observedAt,
    summary: {
      total: packages.length,
      published,
      missing: packages.length - published,
      complete: published === packages.length
    },
    packages
  };
}

export function classifyNpmViewResult(result, expectedVersion) {
  if (result.status === 0) {
    let actualVersion;
    try {
      actualVersion = JSON.parse(result.stdout.trim());
    } catch {
      actualVersion = result.stdout.trim();
    }
    if (actualVersion !== expectedVersion) {
      throw new Error("npm returned an unexpected package version.");
    }
    return "published";
  }

  const failureOutput = `${result.stdout}\n${result.stderr}`;
  if (/\bE404\b|404 Not Found/i.test(failureOutput)) {
    return "missing";
  }

  throw new Error("npm registry publication lookup failed.");
}

function lookupPublication(name, version) {
  const npmArgs = [
    "view",
    `${name}@${version}`,
    "version",
    "--json",
    "--registry=https://registry.npmjs.org/"
  ];
  const command = process.platform === "win32"
    ? (process.env.ComSpec ?? "cmd.exe")
    : "npm";
  const commandArgs = process.platform === "win32"
    ? ["/d", "/s", "/c", `npm ${npmArgs.join(" ")}`]
    : npmArgs;
  const result = spawnSync(
    command,
    commandArgs,
    { encoding: "utf8" }
  );

  return classifyNpmViewResult({
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  }, version);
}

function parseArguments(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag === undefined || !flag.startsWith("--") || value === undefined) {
      throw new Error("Publication state arguments must be flag-value pairs.");
    }
    values.set(flag.slice(2), value);
  }

  const required = ["version", "tag", "commit", "run-id", "run-attempt", "phase", "output"];
  for (const name of required) {
    if (!values.has(name)) {
      throw new Error(`Missing required --${name} argument.`);
    }
  }

  const version = values.get("version");
  const phase = values.get("phase");
  parseReleaseVersion(version);
  if (phase !== "before" && phase !== "after") {
    throw new Error("Publication state phase must be before or after.");
  }

  return {
    version,
    tagName: values.get("tag"),
    commitSha: values.get("commit"),
    workflowRunId: values.get("run-id"),
    workflowRunAttempt: values.get("run-attempt"),
    phase,
    outputPath: values.get("output")
  };
}

function main() {
  const args = parseArguments(process.argv.slice(2));
  const manifest = collectPublicationState({
    ...args,
    observedAt: new Date().toISOString(),
    lookup: lookupPublication
  });
  const outputPath = resolve(args.outputPath);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(
    `Publication state ${manifest.phase}: ${manifest.summary.published}/${manifest.summary.total} packages published.\n`
  );
}

const invokedPath = process.argv[1] === undefined
  ? undefined
  : pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath === import.meta.url) {
  main();
}
