import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { WORKSPACE_PACKAGE_NAMES } from "./lib/workspace-packages.mjs";
import { parseReleaseVersion } from "./release-version.mjs";
import { HttpReadError, readJson } from "./lib/http-read.mjs";

const REGISTRY = "https://registry.npmjs.org/";

export async function lookupPublishedPackage(name, version, timeoutMs = 10_000, fetchImpl = fetch, { signal, onTransient } = {}) {
  const url = `${REGISTRY}${encodeURIComponent(name)}`;
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  let metadata, packument;
  try {
    const options = { signal: controller.signal, timeoutMs, fetchImpl, allowNotFound: true, maxRetries: 0 };
    [metadata, packument] = await Promise.all([
      readJson(`${url}/${version}`, options), readJson(url, options)
    ]);
  } catch (error) {
    if (!signal?.aborted && error instanceof HttpReadError && error.retryable) {
      onTransient?.(error);
      return undefined;
    }
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
    controller.abort();
  }
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
  log = console.log,
  signal,
  random = Math.random
} = {}) {
  const release = parseReleaseVersion(version);
  if (![timeoutMs, intervalMs].every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw new Error("Registry wait durations must be positive safe integers.");
  }
  const deadline = now() + timeoutMs;
  let pending = WORKSPACE_PACKAGE_NAMES;
  let lastTransient;
  let transientRounds = 0;
  while (now() < deadline) {
    signal?.throwIfAborted();
    let roundFailure;
    const requestTimeout = Math.max(1, Math.min(10_000, Math.floor(deadline - now())));
    const states = await Promise.all(WORKSPACE_PACKAGE_NAMES.map(async (name) => {
      const state = await lookup(name, version, requestTimeout, undefined, { signal,
        onTransient(error) { roundFailure = lastTransient = error; } });
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
    transientRounds = roundFailure === undefined ? 0 : transientRounds + 1;
    const backoff = roundFailure === undefined ? intervalMs
      : Math.max(roundFailure.retryAfterMs ?? 0,
        Math.max(1, Math.floor(random() * Math.min(120_000, intervalMs * 2 ** Math.min(transientRounds - 1, 4)))));
    await sleep(Math.min(backoff, remaining), undefined, { signal });
  }
  throw new Error(`npm publication did not become visible within ${timeoutMs / 1000}s: ${pending.join(", ")}.`, { cause: lastTransient });
}

if (process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await waitForPublishedPackages(process.env.RELEASE_VERSION);
}
