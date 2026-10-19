import assert from "node:assert/strict";
import test from "node:test";
import { WORKSPACE_PACKAGE_NAMES } from "./lib/workspace-packages.mjs";
import { lookupPublishedPackage, waitForPublishedPackages } from "./wait-for-registry-packages.mjs";

function clock() {
  let time = 0;
  return { now: () => time, sleep: async (ms) => { time += ms; }, log() {} };
}

test("waits for every exact version and dist-tag under one shared deadline", async () => {
  const timing = clock();
  const calls = [];
  await waitForPublishedPackages("1.0.1", {
    ...timing, timeoutMs: 1000, intervalMs: 100,
    lookup: async (name) => {
      calls.push(name);
      if (timing.now() === 0 && name === WORKSPACE_PACKAGE_NAMES[0]) return undefined;
      return { version: "1.0.1", tags: { latest: timing.now() < 200 ? "1.0.0" : "1.0.1" } };
    }
  });
  assert.equal(timing.now(), 200);
  assert.equal(calls.length, WORKSPACE_PACKAGE_NAMES.length * 3);
});

test("ready packages require no sleep and pending packages time out without a per-package delay", async () => {
  const immediate = clock();
  await waitForPublishedPackages("1.0.1", {
    ...immediate, lookup: async () => ({ version: "1.0.1", tags: { latest: "1.0.1" } })
  });
  assert.equal(immediate.now(), 0);
  const timeout = clock();
  await assert.rejects(waitForPublishedPackages("1.0.1", {
    ...timeout, timeoutMs: 250, intervalMs: 100, lookup: async () => undefined
  }), /within 0.25s/);
  assert.equal(timeout.now(), 250);
});

test("prereleases require next and must never replace latest", async () => {
  await waitForPublishedPackages("1.0.1-rc.1", {
    ...clock(), lookup: async () => ({ version: "1.0.1-rc.1", tags: { next: "1.0.1-rc.1", latest: "1.0.0" } })
  });
  await assert.rejects(waitForPublishedPackages("1.0.1-rc.1", {
    ...clock(), lookup: async () => ({ version: "1.0.1-rc.1", tags: { next: "1.0.1-rc.1", latest: "1.0.1-rc.1" } })
  }), /Prerelease unexpectedly replaced npm latest/);
});

test("request time is included in the wait budget", async () => {
  const timing = clock();
  await assert.rejects(waitForPublishedPackages("1.0.1", {
    ...timing, timeoutMs: 100, intervalMs: 10,
    lookup: async (_, __, requestTimeout) => {
      assert(requestTimeout <= 100);
      if (timing.now() === 0) await timing.sleep(100);
      return undefined;
    }
  }), /did not become visible/);
  assert.equal(timing.now(), 100);
});

test("lookup requires exact metadata and the installable root packument", async () => {
  const name = WORKSPACE_PACKAGE_NAMES[0];
  const responses = (hasRootVersion) => async (url, options) => {
    assert(options.signal instanceof AbortSignal);
    return Response.json(url.endsWith("/1.0.1")
      ? { name, version: "1.0.1", dist: { tarball: "https://registry.npmjs.org/package.tgz" } }
      : { name, versions: hasRootVersion ? { "1.0.1": { version: "1.0.1" } } : {}, "dist-tags": { latest: "1.0.1" } });
  };
  assert.equal((await lookupPublishedPackage(name, "1.0.1", 1000, responses(false))).version, undefined);
  assert.equal((await lookupPublishedPackage(name, "1.0.1", 1000, responses(true))).version, "1.0.1");
});

test("transient registry failures retry; authorization and malformed responses fail closed", async () => {
  const args = [WORKSPACE_PACKAGE_NAMES[0], "1.0.1", 1000];
  for (const status of [404, 408, 429, 503]) {
    assert.equal(await lookupPublishedPackage(...args, async () => new Response("", { status })), undefined);
  }
  assert.equal(await lookupPublishedPackage(...args, async () => { throw new TypeError("offline"); }), undefined);
  await assert.rejects(lookupPublishedPackage(...args, async () => new Response("", { status: 403 })), /HTTP 403/);
  await assert.rejects(lookupPublishedPackage(...args, async () => new Response("not JSON")), /invalid JSON/);
  await assert.rejects(lookupPublishedPackage(...args, async () => Response.json({})), /invalid publication metadata/);
});
