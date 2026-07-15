import type { ValidatorIssue } from "@0disoft/universal-config-engine-core";

const supportedIssue: ValidatorIssue = {
  code: "invalid_port",
  severity: "error",
  path: ["service", "port"]
};

const legacyCategory: ValidatorIssue = {
  code: "invalid_port",
  severity: "error",
  // @ts-expect-error Removed from the 1.0 public validator contract.
  category: "validation"
};

const legacyMessage: ValidatorIssue = {
  code: "invalid_port",
  severity: "error",
  // @ts-expect-error Removed from the 1.0 public validator contract.
  message: "Port is invalid."
};

const legacySourceId: ValidatorIssue = {
  code: "invalid_port",
  severity: "error",
  // @ts-expect-error Removed from the 1.0 public validator contract.
  sourceId: "untrusted-validator"
};

const legacyDetails: ValidatorIssue = {
  code: "invalid_port",
  severity: "error",
  // @ts-expect-error Removed from the 1.0 public validator contract.
  details: { received: 0 }
};

void [supportedIssue, legacyCategory, legacyMessage, legacySourceId, legacyDetails];
