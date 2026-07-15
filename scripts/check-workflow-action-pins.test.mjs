import assert from "node:assert/strict";
import test from "node:test";

import { findWorkflowActionPinViolations } from "./check-workflow-action-pins.mjs";

test("accepts immutable remote, local, and Docker action references", () => {
  const content = `
steps:
  - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
  - uses: "github/codeql-action/init@99df26d4f13ea111d4ec1a7dddef6063f76b97e9"
  - uses: './.github/actions/local-check'
  - uses: docker://alpine@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
`;

  assert.deepEqual(findWorkflowActionPinViolations(content), []);
});

test("rejects mutable and abbreviated remote action references", () => {
  const content = `
steps:
  - uses: actions/checkout@v7
  - uses: actions/setup-node@main
  - uses: github/codeql-action/analyze@99df26d
`;

  assert.deepEqual(findWorkflowActionPinViolations(content, "ci.yml"), [
    "ci.yml:3 must pin remote actions to a full commit SHA: actions/checkout@v7",
    "ci.yml:4 must pin remote actions to a full commit SHA: actions/setup-node@main",
    "ci.yml:5 must pin remote actions to a full commit SHA: github/codeql-action/analyze@99df26d"
  ]);
});

test("rejects Docker tags and malformed uses references", () => {
  const content = `
steps:
  - uses: docker://alpine:3.22
  - uses:
  - uses: invalid-reference
`;

  assert.deepEqual(findWorkflowActionPinViolations(content, "security.yml"), [
    "security.yml:3 must pin Docker actions by sha256 digest: docker://alpine:3.22",
    "security.yml:4 has an empty or unsupported uses reference",
    "security.yml:5 must pin remote actions to a full commit SHA: invalid-reference"
  ]);
});
