import {
  runValidators,
  type ConfigIssue,
  type ValidatorAdapter
} from "@0disoft/universal-config-engine-core";

const legacyIssues: ConfigIssue[] = [
  {
    category: "validation",
    code: "legacy_port_invalid",
    severity: "error",
    path: ["server", "port"],
    sourceId: "legacy-spoofed-source",
    message: "Legacy validator rejected legacy-secret-value.",
    details: {
      received: "legacy-secret-value"
    }
  }
];

const legacyValidator: ValidatorAdapter = {
  id: "legacy-validator",
  validate() {
    return {
      ok: false,
      issues: legacyIssues
    };
  }
};

const validation = await runValidators({
  config: {
    server: {
      port: 0
    }
  },
  provenance: [],
  validators: [legacyValidator]
});

const issue = validation.issues[0];
if (
  issue?.code !== "legacy_port_invalid" ||
  issue.sourceId !== "legacy-validator" ||
  issue.message !== "Validator legacy-validator reported validation issue legacy_port_invalid." ||
  JSON.stringify(validation).includes("legacy-secret-value")
) {
  throw new Error("Legacy validator compatibility smoke failed.");
}
