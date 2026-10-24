import { describe, expect, it } from "vitest";
import { buildDiagnosticReport, resolveConfig, runConfigPipeline, buildConfigInspection } from "../src/index.js";
import type { ConfigIssue, ProvenanceEvent } from "../src/index.js";
import { source } from "./helpers/source.js";

describe("buildDiagnosticReport", () => {
  it("separates validator failures from a loaded secret source with the same id", async () => {
    const result = await runConfigPipeline({ context: undefined,
      loaders: [{ descriptor: { id: "config", kind: "object", priority: 0, displayName: "config",
        redaction: { secretSource: true } }, load: () => ({ value: {} }) }],
      validators: [{ id: "config", validate: () => ({ ok: false, issues: [
        { code: "invalid_port", severity: "error", path: ["server", "port"] },
        { code: "missing_password", severity: "error", path: ["auth", "password"] }
      ] }) }]
    });
    expect(result.report.sources[0]?.status).toBe("loaded");
    expect(result.report.issues[0]).toMatchObject({ sourceId: "config", validatorId: "config" });
    expect(result.report.issues[0]?.message).toContain("invalid_port");
    expect(result.report.issues[1]?.message).toMatch(/^Diagnostic message redacted/);
    expect(result.report.issues[1]?.validatorId).toBe("config");
    expect(result.report.provenance.find(event => event.action === "validated")?.message).toContain("completed");
    const actualFailure = buildDiagnosticReport({ ...result.result, issues: [
      { category: "parse", code: "parse_failed", severity: "error", sourceId: "config", message: "parse failure" }
    ] });
    expect(actualFailure.sources[0]?.status).toBe("failed");
  });

  it.each(["descriptor", "options"].flatMap(policy => [2, 200].map(maxDiagnostics => ({ policy, maxDiagnostics }))))(
    "fails closed when $policy ownership is truncated at diagnostic budget $maxDiagnostics", async ({ policy, maxDiagnostics }) => {
    const loaders = [
      { descriptor: { id: "private", kind: "object" as const, priority: 0, displayName: "private",
          ...(policy === "descriptor" ? { redaction: { secretSource: true } } : {}) },
        load: () => ({ value: { first: 1, hidden: "UCE_TRUNCATED_MARKER" } }) },
      { descriptor: { id: "public", kind: "object" as const, priority: 1, displayName: "public" },
        load: () => ({ value: {}, issues: [{ category: "parse" as const, code: "custom_warning",
          severity: "warning" as const, path: ["hidden"], message: "UCE_TRUNCATED_MARKER",
          details: { value: "UCE_TRUNCATED_MARKER" } },
          { category: "parse" as const, code: "another_warning", severity: "warning" as const,
            path: ["hidden"], message: "UCE_TRUNCATED_MARKER" }] }) }
    ];
    const reportOptions = policy === "options" ? { secretSourceIds: ["private"] } : {};
    const failed = await runConfigPipeline({ context: undefined, loaders, reportOptions, limits: { maxResolvedPaths: 1, maxDiagnostics } });
    expect(failed.result.ok).toBe(false);
    expect(failed.report.issues).toEqual([expect.objectContaining({
      code: maxDiagnostics === 2 ? "max_diagnostics_exceeded" : "max_resolved_paths_exceeded"
    })]);
    expect(failed.report.provenance).toEqual([]);
    expect(JSON.stringify(failed.report)).not.toContain("UCE_TRUNCATED_MARKER");
    expect(JSON.stringify(buildConfigInspection(failed.result, reportOptions))).not.toContain("UCE_TRUNCATED_MARKER");
    const complete = await runConfigPipeline({ context: undefined, loaders, reportOptions });
    expect(complete.report.issues[0]?.message).toMatch(/^Diagnostic message redacted/);
  });

  it.each(["descriptor", "options"])("inherits %s secret-source ownership for atomic array descendants", (policy) => {
    const vault = source("vault", 0, { users: [{ label: "array input" }] });
    const resolved = resolveConfig({ sources: [
      { ...vault, descriptor: { ...vault.descriptor, ...(policy === "descriptor" ? { redaction: { secretSource: true } } : {}) } },
      source("override", 10, { users: [{ label: "replacement input" }], public: { label: "public input" } })
    ] });
    const issues: readonly ConfigIssue[] = [["users", 0, "label"], ["public", "label"]].map((path) => ({
      category: "validation", severity: "warning", code: "field_warning", sourceId: "checker", path,
      message: "Diagnostic input.", details: { input: "diagnostic input" }
    }));
    const provenance: readonly ProvenanceEvent[] = [{ path: ["users", 0, "label"],
      action: "coerced", sourceId: "core:coercion", message: "Conversion input." }];
    const report = buildDiagnosticReport({ ...resolved, issues, provenance }, policy === "options" ? { secretSourceIds: ["vault"] } : {});
    expect(report.issues[0]?.message).toMatch(/^Diagnostic message redacted/);
    expect(report.issues[0]?.details).toBeUndefined();
    expect(report.provenance[0]?.message).toMatch(/^Provenance message redacted/);
    expect(report.issues[1]).toEqual(issues[1]);
  });

  it.each([
    { policy: { secretPaths: [["service"]] }, reason: "secret-path" },
    { policy: { secretNamePatterns: ["INTERNAL_VALUE"] }, reason: "secret-name" },
    { policy: { secretSource: true }, reason: "secret-source" },
    { policy: {}, reason: "secret-source" }
  ])("retains overridden source redaction in resolved paths ($policy, $reason)", ({ policy, reason }) => {
    const lower = source("vault", 0, { service: { internal_value: "lower input" } });
    const resolved = resolveConfig({
      sources: [
        { ...lower, descriptor: { ...lower.descriptor, redaction: policy } },
        source("file", 10, { service: { internal_value: "file input" } }),
        source("cli", 20, { service: { internal_value: "cli input" } })
      ]
    });
    const report = buildDiagnosticReport(resolved, Object.keys(policy).length === 0 ? { secretSourceIds: ["vault"] } : {});

    expect(report.resolvedPaths).toContainEqual(expect.objectContaining({
      path: ["service", "internal_value"],
      winningSourceId: "cli",
      overriddenSourceIds: ["vault", "file"],
      redacted: true,
      redactionReason: reason
    }));
    expect(report.provenance.filter((event) => event.path.join(".") === "service.internal_value")
      .every((event) => event.message.startsWith("Provenance message redacted"))).toBe(true);
  });

  it.each([{ patterns: [] }, { patterns: ["LOCAL_CODE"] }])("combines option name patterns with source patterns $patterns", ({ patterns }) => {
    const input = source("defaults", 0, { local_code: "local input", global_code: "global input", visible: "public input" });
    const resolved = resolveConfig({ sources: [{
      ...input,
      descriptor: { ...input.descriptor, redaction: { secretNamePatterns: patterns } }
    }] });
    const issues: readonly ConfigIssue[] = ["local_code", "global_code", "visible"].map((name) => ({
      category: "validation",
      code: "field_warning",
      severity: "warning",
      sourceId: "defaults",
      path: [name],
      message: `Diagnostic for ${name}.`
    }));
    const report = buildDiagnosticReport({ ...resolved, issues }, { secretNamePatterns: ["GLOBAL_CODE"] });
    const masked = ["global_code", ...(patterns.length === 0 ? [] : ["local_code"])];

    for (const name of ["local_code", "global_code", "visible"]) {
      expect(report.resolvedPaths.find((path) => path.path[0] === name)?.redacted).toBe(masked.includes(name));
      expect(report.issues.find((issue) => issue.path?.[0] === name)?.message)
        .toBe(masked.includes(name) ? "Diagnostic message redacted because it is associated with a secret path or source." : `Diagnostic for ${name}.`);
      expect(report.provenance.find((event) => event.path[0] === name)?.message.startsWith("Provenance message redacted"))
        .toBe(masked.includes(name));
    }
  });

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
    expect(report.resolvedPaths).toContainEqual(expect.objectContaining({
      path: ["service", "private_value"],
      redacted: true
    }));
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
