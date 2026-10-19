import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { WORKSPACE_PACKAGE_NAMES } from "./lib/workspace-packages.mjs";
import { parseReleaseVersion } from "./release-version.mjs";

const REGISTRY = "https://registry.npmjs.org/";

async function registryJson(url, signal, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, { signal });
  } catch {
    return undefined;
  }
  if ([404, 408, 429].includes(response.status) || response.status >= 500) return undefined;
  if (!response.ok) throw new Error(`npm registry lookup failed with HTTP ${response.status}.`);
  try {
    return await response.json();
  } catch {
    if (signal.aborted) return undefined;
    throw new Error("npm registry returned invalid JSON.");
  }
}

export async function lookupPublishedPackage(name, version, timeoutMs = 10_000, fetchImpl = fetch) {
  const url = `${REGISTRY}${encodeURIComponent(name)}`;
  const signal = AbortSignal.timeout(timeoutMs);
  const [metadata, packument] = await Promise.all([
    registryJson(`${url}/${version}`, signal, fetchImpl),
    registryJson(url, signal, fetchImpl)
  ]);
  if (metadata === undefined || packument === undefined) return undefined;
  if (
    metadata?.name !== name || metadata.version !== version ||
    typeof metadata.dist?.tarball !== "string" || metadata.dist.tarball.length === 0 ||
    packument?.name !== name || typeof packument["dist-tags"] !== "object" || packument["dist-tags"] === null
  ) {
    throw new Error(`npm returned invalid publication metadata for ${name}.`);
  }
  return { version: packument.versions?.[version]?.version, tags: packument["dist-tags"] };
}

export async function waitForPublishedPackages(version, {
  timeoutMs = 600_000,
  intervalMs = 15_000,
  lookup = lookupPublishedPackage,
  now = () => performance.now(),
  sleep = delay,
  log = console.log
} = {}) {
  const release = parseReleaseVersion(version);
  if (![timeoutMs, intervalMs].every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw new Error("Registry wait durations must be positive safe integers.");
  }
  const deadline = now() + timeoutMs;
  let pending = WORKSPACE_PACKAGE_NAMES;
  while (now() < deadline) {
    const requestTimeout = Math.max(1, Math.min(10_000, Math.floor(deadline - now())));
    const states = await Promise.all(WORKSPACE_PACKAGE_NAMES.map(async (name) => {
      const state = await lookup(name, version, requestTimeout);
      if (release.prerelease && state?.tags?.latest === version) {
        throw new Error(`Prerelease unexpectedly replaced npm latest for ${name}.`);
      }
      return state?.version === version && state.tags?.[release.npmTag] === version;
    }));
    pending = WORKSPACE_PACKAGE_NAMES.filter((_, index) => !states[index]);
    if (pending.length === 0) {
      log(`Registry publication verified: ${WORKSPACE_PACKAGE_NAMES.length}/${WORKSPACE_PACKAGE_NAMES.length} packages at ${version} (${release.npmTag}).`);
      return;
    }
    const remaining = deadline - now();
    if (remaining <= 0) break;
    log(`Waiting for npm propagation: ${pending.join(", ")} (${Math.ceil(remaining / 1000)}s remaining).`);
    await sleep(Math.min(intervalMs, remaining));
  }
  throw new Error(`npm publication did not become visible within ${timeoutMs / 1000}s: ${pending.join(", ")}.`);
}

if (process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await waitForPublishedPackages(process.env.RELEASE_VERSION);
}
