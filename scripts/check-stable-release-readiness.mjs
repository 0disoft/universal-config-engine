import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { RELEASE_PACKAGE_NAMES } from "./record-publication-state.mjs";
import { parseReleaseVersion } from "./release-version.mjs";

const PROVENANCE_PREDICATE = "https://slsa.dev/provenance/v1";
const policyPath = new URL("../release-policy.json", import.meta.url);

export function resolveStableReleaseRequirement(version, policy) {
  const parsedVersion = parseReleaseVersion(version);
  if (parsedVersion.prerelease) {
    return undefined;
  }

  validatePolicy(policy);
  const requirement = policy.stableReleases[version];
  if (requirement === undefined) {
    throw new Error(`Stable release ${version} is not authorized by release-policy.json.`);
  }

  const candidate = parseReleaseVersion(requirement.candidateVersion);
  const previousStable = parseReleaseVersion(requirement.previousStableVersion);
  if (!candidate.prerelease) {
    throw new Error("Stable release policy candidateVersion must be a prerelease version.");
  }
  if (previousStable.prerelease) {
    throw new Error("Stable release policy previousStableVersion must be stable.");
  }
  if (!Number.isSafeInteger(requirement.minimumReviewHours) || requirement.minimumReviewHours <= 0) {
    throw new Error("Stable release policy minimumReviewHours must be a positive safe integer.");
  }

  return requirement;
}

export function evaluateStableReleaseReadiness(input) {
  const requirement = resolveStableReleaseRequirement(input.version, input.policy);
  if (requirement === undefined) {
    return {
      required: false
    };
  }

  const expectedTag = `v${requirement.candidateVersion}`;
  const release = input.candidateRelease;
  if (
    release.tagName !== expectedTag ||
    release.draft !== false ||
    release.prerelease !== true
  ) {
    throw new Error(`Reviewed candidate ${expectedTag} is not a published GitHub prerelease.`);
  }

  const publishedAt = Date.parse(release.publishedAt);
  const now = Date.parse(input.now);
  if (!Number.isFinite(publishedAt) || !Number.isFinite(now)) {
    throw new Error("Stable release readiness timestamps must be valid ISO date-time text.");
  }
  const notBefore = publishedAt + requirement.minimumReviewHours * 60 * 60 * 1000;
  if (now < notBefore) {
    throw new Error(
      `Stable release review period is incomplete; retry after ${new Date(notBefore).toISOString()}.`
    );
  }

  const assetNames = new Set(release.assets.map((asset) => asset.name));
  for (const packageName of RELEASE_PACKAGE_NAMES) {
    const tarballName = packageTarballName(packageName, requirement.candidateVersion);
    if (!assetNames.has(tarballName)) {
      throw new Error(`Reviewed candidate release is missing tarball ${tarballName}.`);
    }
  }
  if (![...assetNames].some((name) => /^publication-state-.+-before\.json$/.test(name))) {
    throw new Error("Reviewed candidate release is missing before-publication evidence.");
  }
  if (![...assetNames].some((name) => /^publication-state-.+-after\.json$/.test(name))) {
    throw new Error("Reviewed candidate release is missing after-publication evidence.");
  }

  const completePublication = input.publicationStates.some((state) => (
    state.releaseVersion === requirement.candidateVersion &&
    state.tagName === expectedTag &&
    state.phase === "after" &&
    state.summary?.total === RELEASE_PACKAGE_NAMES.length &&
    state.summary?.published === RELEASE_PACKAGE_NAMES.length &&
    state.summary?.missing === 0 &&
    state.summary?.complete === true
  ));
  if (!completePublication) {
    throw new Error("Reviewed candidate has no complete after-publication manifest.");
  }

  const packageStates = new Map(input.packageStates.map((state) => [state.name, state]));
  for (const packageName of RELEASE_PACKAGE_NAMES) {
    const state = packageStates.get(packageName);
    if (
      state === undefined ||
      state.version !== requirement.candidateVersion ||
      typeof state.integrity !== "string" ||
      state.integrity.length === 0 ||
      state.provenancePredicate !== PROVENANCE_PREDICATE ||
      state.nextTag !== requirement.candidateVersion ||
      ![requirement.previousStableVersion, input.version].includes(state.latestTag)
    ) {
      throw new Error(`Reviewed candidate registry state is invalid for ${packageName}.`);
    }
  }

  return {
    required: true,
    candidateVersion: requirement.candidateVersion,
    notBefore: new Date(notBefore).toISOString()
  };
}

function validatePolicy(policy) {
  if (
    policy === null ||
    typeof policy !== "object" ||
    policy.schemaVersion !== "0.1" ||
    policy.stableReleases === null ||
    typeof policy.stableReleases !== "object" ||
    Array.isArray(policy.stableReleases)
  ) {
    throw new Error("release-policy.json must match stable release policy schema 0.1.");
  }
}

function packageTarballName(packageName, version) {
  return `${packageName.replace(/^@/, "").replace("/", "-")}-${version}.tgz`;
}

async function collectRemoteReadinessInput(version, repository, policy) {
  const requirement = resolveStableReleaseRequirement(version, policy);
  if (requirement === undefined) {
    return {
      version,
      policy,
      now: new Date().toISOString()
    };
  }

  const token = process.env.GITHUB_TOKEN;
  if (token === undefined || token.length === 0) {
    throw new Error("GITHUB_TOKEN is required to verify stable release readiness.");
  }

  const candidateTag = `v${requirement.candidateVersion}`;
  const release = await fetchJson(
    `https://api.github.com/repos/${repository}/releases/tags/${encodeURIComponent(candidateTag)}`,
    {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    }
  );

  const afterAssets = release.assets.filter((asset) => /^publication-state-.+-after\.json$/.test(asset.name));
  const publicationStates = await Promise.all(
    afterAssets.map((asset) => fetchJson(asset.browser_download_url, {
      Authorization: `Bearer ${token}`,
      Accept: "application/octet-stream"
    }))
  );

  const packageStates = await Promise.all(RELEASE_PACKAGE_NAMES.map(async (name) => {
    const encodedName = encodeURIComponent(name);
    const [metadata, packument] = await Promise.all([
      fetchJson(`https://registry.npmjs.org/${encodedName}/${requirement.candidateVersion}`),
      fetchJson(`https://registry.npmjs.org/${encodedName}`)
    ]);
    return {
      name,
      version: metadata.version,
      integrity: metadata.dist?.integrity,
      provenancePredicate: metadata.dist?.attestations?.provenance?.predicateType,
      nextTag: packument["dist-tags"]?.next,
      latestTag: packument["dist-tags"]?.latest
    };
  }));

  return {
    version,
    policy,
    now: new Date().toISOString(),
    candidateRelease: {
      tagName: release.tag_name,
      draft: release.draft,
      prerelease: release.prerelease,
      publishedAt: release.published_at,
      assets: release.assets.map((asset) => ({ name: asset.name }))
    },
    publicationStates,
    packageStates
  };
}

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Release readiness lookup failed with HTTP ${response.status}.`);
  }
  return response.json();
}

function parseArguments(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag === undefined || !flag.startsWith("--") || value === undefined) {
      throw new Error("Stable release readiness arguments must be flag-value pairs.");
    }
    values.set(flag.slice(2), value);
  }

  const version = values.get("version");
  const repository = values.get("repository");
  if (version === undefined || repository === undefined) {
    throw new Error("Stable release readiness requires --version and --repository.");
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("Stable release readiness repository must be owner/name.");
  }
  return { version, repository };
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const policy = JSON.parse(readFileSync(policyPath, "utf8"));
  const readiness = evaluateStableReleaseReadiness(
    await collectRemoteReadinessInput(args.version, args.repository, policy)
  );

  const output = process.env.GITHUB_OUTPUT;
  if (output !== undefined && output.length > 0) {
    appendFileSync(output, `required=${readiness.required}\n`, "utf8");
    if (readiness.required) {
      appendFileSync(output, `candidate_version=${readiness.candidateVersion}\n`, "utf8");
      appendFileSync(output, `not_before=${readiness.notBefore}\n`, "utf8");
    }
  }

  if (readiness.required) {
    process.stdout.write(
      `Stable release gate passed for ${args.version} using ${readiness.candidateVersion}; review completed at ${readiness.notBefore}.\n`
    );
  } else {
    process.stdout.write(`Stable release gate does not apply to prerelease ${args.version}.\n`);
  }
}

const invokedPath = process.argv[1] === undefined
  ? undefined
  : pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath === import.meta.url) {
  await main();
}
