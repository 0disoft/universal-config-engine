import { describe, expect, it } from "vitest";

import type { ValidatorIssue } from "../src/index.js";

describe("ValidatorIssue public type", () => {
  it("exposes only structured fields trusted by core", () => {
    const issue: ValidatorIssue = {
      code: "invalid_port",
      severity: "error",
      path: ["service", "port"]
    };

    expect(issue).toEqual({
      code: "invalid_port",
      severity: "error",
      path: ["service", "port"]
    });
  });

  it("does not advertise ignored legacy diagnostic fields", () => {
    const legacyIssue: ValidatorIssue = {
      code: "invalid_port",
      severity: "error",
      // @ts-expect-error Removed in the 1.0 public type; core never trusted this field.
      message: "Port is invalid."
    };

    expect(legacyIssue.code).toBe("invalid_port");
  });
});
