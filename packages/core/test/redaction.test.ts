import { describe, expect, it } from "vitest";
import { buildDiagnosticReport, resolveConfig } from "../src/index.js";
import type { ConfigIssue, ProvenanceEvent } from "../src/index.js";
import { source } from "./helpers/source.js";

describe("buildDiagnosticReport", () => {
  it.each([
    { policy: "descriptor", value: {} },
    { policy: "descriptor", value: { internal: { value: "unrelated private input" } } },
    { policy: "options", value: {} },
    { policy: "options", value: { internal: { value: "unrelated private input" } } }
  ])("preserves public diagnostics beside an unrelated $policy secret source ($value)", ({ policy, value }) => {
    const secret = source("private", 10, value);
    const resolved = resolveConfig({
      sources: [source("defaults", 0, { server: { port: 3000 } }), {
        ...secret,
        descriptor: { ...secret.descriptor, ...(policy === "descriptor" ? { redaction: { secretSource: true } } : {}) }
      }]
    });
    const issues: readonly ConfigIssue[] = ["defaults", "json-file", "validator", "core:coercion", undefined].map((sourceId, index) => ({
      category: "validation",
      code: `public_issue_${index}`,
      severity: "warning",
      path: ["server", "port"],
      ...(sourceId === undefined ? {} : { sourceId }),
      message: `Public diagnostic ${index}.`,
      details: { expected: "valid public port" }
    }));
    const provenance: readonly ProvenanceEvent[] = ["defaults", "json-file", "validator", "core:coercion"].map((sourceId) => ({
      path: ["server", "port"],
      action: "validated",
      sourceId,
      message: `Public provenance from ${sourceId}.`
    }));
    const report = buildDiagnosticReport({ ...resolved, issues, provenance }, policy === "options" ? { secretSourceIds: ["private"] } : {});

    expect(report.issues).toEqual(issues);
    expect(report.provenance).toEqual(provenance);
    expect(report.resolvedPaths).toContainEqual(expect.objectContaining({ path: ["server", "port"], redacted: false }));
  });

  it.each(["descriptor", "options"])("protects direct, winning, and overridden secret-source diagnostics via %s", (policy) => {
    const secret = source("private", 10, { service: { value: "private input" } });
    const sources = [source("defaults", 0, { server: { port: 3000 } }), {
      ...secret,
      descriptor: { ...secret.descriptor, ...(policy === "descriptor" ? { redaction: { secretSource: true } } : {}) }
    }];
    const options = policy === "options" ? { secretSourceIds: ["private"] } : {};
    for (const publicOverride of [false, true]) {
      const resolved = resolveConfig({ sources: publicOverride ? [...sources, source("override", 20, { service: { value: "public replacement" } })] : sources });
      const issues: readonly ConfigIssue[] = [
        { category: "validation", code: "dependent_failure", severity: "error", sourceId: "validator", path: ["service", "value"], message: "private input", details: { raw: "private input" } },
        { category: "source-load", code: "direct_failure", severity: "error", sourceId: "private", path: ["unresolved"], message: "private input" }
      ];
      const provenance: readonly ProvenanceEvent[] = [
        { path: ["service", "value"], action: "coerced", sourceId: "core:coercion", message: "private input" },
        { path: ["unresolved"], action: "overridden", sourceId: "override", previousSourceId: "private", message: "private input" },
        { path: ["unresolved"], action: "rejected", sourceId: "private", message: "private input" }
      ];
      const report = buildDiagnosticReport({ ...resolved, issues, provenance }, options);

      expect(report.issues.every((issue) => issue.message.startsWith("Diagnostic message redacted"))).toBe(true);
      expect(report.issues.every((issue) => issue.details === undefined)).toBe(true);
      expect(report.provenance.every((event) => event.message.startsWith("Provenance message redacted"))).toBe(true);
      expect(report.provenance[1]?.previousSourceId).toBe("private");
      expect(JSON.stringify(report)).not.toContain("private input");
    }
  });

  it.each([
    { redaction: { secretPaths: [["service"]] }, options: {} },
    { redaction: { secretNamePatterns: ["private_value"] }, options: {} },
    { redaction: {}, options: { secretPaths: [["service"]] } },
    { redaction: {}, options: { secretNamePatterns: ["private_value"] } }
  ])("preserves explicit path and name policies independently of source participation ($redaction, $options)", ({ redaction, options }) => {
    const empty = source("policy", 10, {});
    const resolved = resolveConfig({ sources: [source("defaults", 0, { service: { private_value: "private input" } }), {
      ...empty,
      descriptor: { ...empty.descriptor, redaction }
    }] });
    const report = buildDiagnosticReport({ ...resolved,
      issues: [{ category: "validation", code: "private_failure", severity: "error", sourceId: "validator", path: ["service", "private_value"], message: "private input" }],
      provenance: [{ action: "validated", sourceId: "validator", path: ["service", "private_value"], message: "private input" }]
    }, options);
    expect(JSON.stringify(report)).not.toContain("private input");
  });

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
