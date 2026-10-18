import { describe, expect, it } from "vitest";
import { buildDiagnosticReport, resolveConfig } from "../src/index.js";

describe("buildDiagnosticReport", () => {
  it("replaces oversized reports with a bounded error report", () => {
    const result = resolveConfig({
      sources: [{
        descriptor: { id: "large", kind: "object", priority: 0, displayName: "x".repeat(4_000) },
        value: { enabled: true }
      }],
      limits: { maxReportBytes: 1024 }
    });
    const report = buildDiagnosticReport(result);
    expect(report.status).toBe("error");
    expect(report.issues).toEqual([expect.objectContaining({ code: "max_report_bytes_exceeded" })]);
    expect(new TextEncoder().encode(JSON.stringify(report)).byteLength).toBeLessThanOrEqual(1024);
  });

  it.each([
    {
      name: "descriptor secret source with a pathless issue",
      redaction: { secretSource: true },
      options: {},
      configPath: ["service", "value"],
      issuePath: undefined,
      reason: "secret-source"
    },
    {
      name: "option secret source with a pathless issue",
      redaction: undefined,
      options: { secretSourceIds: ["defaults"] },
      configPath: ["service", "value"],
      issuePath: undefined,
      reason: "secret-source"
    },
    {
      name: "descriptor parent secret path",
      redaction: { secretPaths: [["service"]] },
      options: {},
      configPath: ["service", "value"],
      issuePath: ["service", "value"],
      reason: "secret-path"
    },
    {
      name: "option secret path",
      redaction: undefined,
      options: { secretPaths: [["service", "value"]] },
      configPath: ["service", "value"],
      issuePath: ["service", "value"],
      reason: "secret-path"
    },
    {
      name: "descriptor custom secret name",
      redaction: { secretNamePatterns: ["private_value"] },
      options: {},
      configPath: ["service", "private_value"],
      issuePath: ["service", "private_value"],
      reason: "secret-name"
    },
    {
      name: "default secret name",
      redaction: undefined,
      options: {},
      configPath: ["service", "access_token"],
      issuePath: ["service", "access_token"],
      reason: "secret-name"
    }
  ])("redacts combined diagnostic fields for $name", ({ redaction, options, configPath, issuePath, reason }) => {
    const secretValue = "matrix-secret-value";
    const result = resolveConfig({
      sources: [
        {
          descriptor: {
            id: "defaults",
            kind: "object",
            priority: 0,
            displayName: "defaults",
            ...(redaction === undefined ? {} : { redaction })
          },
          value: {
            service: {
              [String(configPath[1])]: secretValue
            }
          },
          issues: [
            {
              category: "source-load",
              code: "matrix_source_failure",
              severity: "warning",
              sourceId: "defaults",
              ...(issuePath === undefined ? {} : { path: issuePath }),
              message: `failed while handling ${secretValue}`,
              details: {
                raw: secretValue
              }
            }
          ]
        }
      ]
    });
    const report = buildDiagnosticReport(result, options);
    const reportText = JSON.stringify(report);

    expect(reportText).not.toContain(secretValue);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: "matrix_source_failure",
        message: "Diagnostic message redacted because it is associated with a secret path or source."
      })
    );
    expect(report.resolvedPaths).toContainEqual(
      expect.objectContaining({
        path: configPath,
        redacted: true,
        redactionReason: reason
      })
    );
  });

  it("does not include raw secret values in diagnostic report structures", () => {
    const result = resolveConfig({
      sources: [
        {
          descriptor: {
            id: "env",
            kind: "object",
            priority: 10,
            displayName: "env",
            redaction: {
              secretPaths: [["database", "password"]]
            }
          },
          value: {
            database: {
              password: "example-secret-value",
              host: "db.internal"
            }
          }
        }
      ]
    });

    const report = buildDiagnosticReport(result);
    const reportText = JSON.stringify(report);

    expect(report.resolvedPaths).toContainEqual({
      path: ["database", "password"],
      status: "resolved",
      winningSourceId: "env",
      overriddenSourceIds: [],
      redacted: true,
      redactionReason: "secret-path"
    });
    expect(reportText).not.toContain("example-secret-value");
    expect(reportText).not.toContain("db.internal");
  });

  it("redacts issue and provenance messages associated with secret paths", () => {
    const result = resolveConfig({
      sources: [
        {
          descriptor: {
            id: "defaults",
            kind: "object",
            priority: 0,
            displayName: "defaults",
            redaction: {
              secretPaths: [["database", "password"]]
            }
          },
          value: {
            database: {
              password: "example-secret-value"
            }
          },
          issues: [
            {
              category: "source-load",
              code: "secret_parse_failed",
              severity: "warning",
              sourceId: "defaults",
              path: ["database", "password"],
              message: "failed while handling example-secret-value",
              details: {
                raw: "example-secret-value"
              }
            }
          ]
        }
      ]
    });
    const report = buildDiagnosticReport(result);
    const reportText = JSON.stringify(report);

    expect(reportText).not.toContain("example-secret-value");
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: "secret_parse_failed",
        message: "Diagnostic message redacted because it is associated with a secret path or source."
      })
    );
    expect(report.provenance).toContainEqual(
      expect.objectContaining({
        path: ["database", "password"],
        message: "Provenance message redacted because it is associated with a secret path or source."
      })
    );
  });

  it("redacts descendant paths when a parent secret path is declared", () => {
    const result = resolveConfig({
      sources: [
        {
          descriptor: {
            id: "defaults",
            kind: "object",
            priority: 0,
            displayName: "defaults",
            redaction: {
              secretPaths: [["database"]]
            }
          },
          value: {
            database: {
              clientId: "example-secret-value"
            }
          },
          issues: [
            {
              category: "source-load",
              code: "secret_child_failed",
              severity: "warning",
              sourceId: "defaults",
              path: ["database", "clientId"],
              message: "failed while handling example-secret-value",
              details: {
                raw: "example-secret-value"
              }
            }
          ]
        }
      ]
    });
    const report = buildDiagnosticReport(result);
    const reportText = JSON.stringify(report);

    expect(report.resolvedPaths).toContainEqual(
      expect.objectContaining({
        path: ["database", "clientId"],
        redacted: true,
        redactionReason: "secret-path"
      })
    );
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: "secret_child_failed",
        message: "Diagnostic message redacted because it is associated with a secret path or source."
      })
    );
    expect(reportText).not.toContain("example-secret-value");
  });

  it("keeps default secret-name literal variants working", () => {
    const result = resolveConfig({
      sources: [
        {
          descriptor: {
            id: "defaults",
            kind: "object",
            priority: 0,
            displayName: "defaults"
          },
          value: {
            service: {
              "api-key": "example-secret-value"
            }
          }
        }
      ]
    });
    const report = buildDiagnosticReport(result);

    expect(report.resolvedPaths).toContainEqual(
      expect.objectContaining({
        path: ["service", "api-key"],
        redacted: true,
        redactionReason: "secret-name"
      })
    );
  });

  it("treats regex-like secret-name patterns as literals", () => {
    const result = resolveConfig({
      sources: [
        {
          descriptor: {
            id: "defaults",
            kind: "object",
            priority: 0,
            displayName: "defaults",
            redaction: {
              secretNamePatterns: ["(a+)+$"]
            }
          },
          value: {
            service: {
              "(a+)+$": "example-secret-value"
            }
          }
        }
      ]
    });
    const report = buildDiagnosticReport(result);

    expect(report.resolvedPaths).toContainEqual(
      expect.objectContaining({
        path: ["service", "(a+)+$"],
        redacted: true,
        redactionReason: "secret-name"
      })
    );
    expect(JSON.stringify(report)).not.toContain("example-secret-value");
  });

  it("does not execute regex-like secret-name patterns", () => {
    const result = resolveConfig({
      sources: [
        {
          descriptor: {
            id: "defaults",
            kind: "object",
            priority: 0,
            displayName: "defaults",
            redaction: {
              secretNamePatterns: ["(a+)+$"]
            }
          },
          value: {
            service: {
              [`${"a".repeat(50_000)}!`]: "public-value"
            }
          }
        }
      ]
    });
    const report = buildDiagnosticReport(result);

    expect(report.resolvedPaths).toContainEqual(
      expect.objectContaining({ redacted: false })
    );
  });
});
