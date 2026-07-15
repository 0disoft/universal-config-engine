import assert from "node:assert/strict";
import test from "node:test";

import { RELEASE_PACKAGE_NAMES } from "./record-publication-state.mjs";
import {
  evaluateStableReleaseReadiness,
  resolveStableReleaseRequirement
} from "./check-stable-release-readiness.mjs";

const policy = {
  schemaVersion: "0.1",
  stableReleases: {
    "1.0.0": {
      candidateVersion: "1.0.0-rc.2",
      previousStableVersion: "0.6.0",
      minimumReviewHours: 168
    }
  }
};

test("skips the stable gate for prerelease versions", () => {
  assert.equal(resolveStableReleaseRequirement("1.0.0-rc.2", policy), undefined);
  assert.deepEqual(evaluateStableReleaseReadiness({ version: "1.0.0-rc.2", policy }), {
    required: false
  });
});

test("rejects stable versions without an explicit policy entry", () => {
  assert.throws(
    () => resolveStableReleaseRequirement("1.0.1", policy),
    /not authorized/
  );
});

test("rejects a stable release before the candidate review period ends", () => {
  const input = validReadinessInput();
  input.now = "2026-07-22T23:59:59.999Z";
  assert.throws(
    () => evaluateStableReleaseReadiness(input),
    /review period is incomplete/
  );
});

test("accepts a complete reviewed candidate and registry state", () => {
  assert.deepEqual(evaluateStableReleaseReadiness(validReadinessInput()), {
    required: true,
    candidateVersion: "1.0.0-rc.2",
    notBefore: "2026-07-23T00:00:00.000Z"
  });
});

test("rejects incomplete publication evidence and provenance", () => {
  const incomplete = validReadinessInput();
  incomplete.publicationStates[0].summary.complete = false;
  assert.throws(
    () => evaluateStableReleaseReadiness(incomplete),
    /no complete after-publication manifest/
  );

  const invalidProvenance = validReadinessInput();
  invalidProvenance.packageStates[0].provenancePredicate = "unexpected";
  assert.throws(
    () => evaluateStableReleaseReadiness(invalidProvenance),
    /registry state is invalid/
  );
});

function validReadinessInput() {
  const candidateVersion = "1.0.0-rc.2";
  return {
    version: "1.0.0",
    policy: structuredClone(policy),
    now: "2026-07-23T00:00:00.000Z",
    candidateRelease: {
      tagName: `v${candidateVersion}`,
      draft: false,
      prerelease: true,
      publishedAt: "2026-07-16T00:00:00.000Z",
      assets: [
        ...RELEASE_PACKAGE_NAMES.map((name) => ({
          name: `${name.replace(/^@/, "").replace("/", "-")}-${candidateVersion}.tgz`
        })),
        { name: "publication-state-run-1-attempt-1-before.json" },
        { name: "publication-state-run-1-attempt-1-after.json" }
      ]
    },
    publicationStates: [
      {
        releaseVersion: candidateVersion,
        tagName: `v${candidateVersion}`,
        phase: "after",
        summary: {
          total: RELEASE_PACKAGE_NAMES.length,
          published: RELEASE_PACKAGE_NAMES.length,
          missing: 0,
          complete: true
        }
      }
    ],
    packageStates: RELEASE_PACKAGE_NAMES.map((name) => ({
      name,
      version: candidateVersion,
      integrity: "sha512-test",
      provenancePredicate: "https://slsa.dev/provenance/v1",
      nextTag: candidateVersion,
      latestTag: "0.6.0"
    }))
  };
}
