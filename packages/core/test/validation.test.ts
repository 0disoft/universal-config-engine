import { describe, expect, it } from "vitest";
import { getConfigValueAtPath, loadConfigSources, runValidators, resolveConfig } from "../src/index.js";
import type { ValidatorResult } from "../src/index.js";
import { source } from "./helpers/source.js";

describe("runValidators", () => {
  it.each(["depth", "bytes", "utf8"])("bounds diagnostic path %s at both adapter boundaries", async budget => {
    const path = budget === "depth" ? new Array(33).fill("x") : [budget === "bytes" ? "x".repeat(1025) : String.fromCodePoint(0x1f600).repeat(300)];
    if (budget === "depth") Object.defineProperty(path, 0, { get() { throw new Error("Must reject length before reading segments."); } });
    const issue = { category: "validation" as const, code: "field", severity: "warning" as const,
      message: "Field issue", path };
    const limits = { maxPathLength: 32, maxReportBytes: 1024 };
    const loaded = await loadConfigSources({ context: undefined, limits, loaders: [{
      descriptor: { id: "adapter", kind: "adapter", priority: 0, displayName: "adapter" },
      load: () => ({ value: {}, issues: [issue] })
    }] });
    const validated = await runValidators({ config: {}, provenance: [], limits, validators: [{
      id: "adapter", validate: () => ({ ok: true, issues: [issue] })
    }] });
    expect(loaded.issues).toEqual([expect.objectContaining({ code: "invalid_loader_result", severity: "error" })]);
    expect(validated.issues).toEqual([expect.objectContaining({ code: "validator_issue_invalid", severity: "error" })]);
    expect(validated.issues[0]?.path).toBeUndefined();
  });

  it("preserves valid typed diagnostic paths at the exact depth limit", async () => {
    const path = ["items", 0];
    const result = await runValidators({ config: {}, provenance: [], limits: { maxPathLength: 2 }, validators: [{
      id: "adapter", validate: () => ({ ok: false, issues: [{ code: "field", severity: "error", path }] })
    }] });
    expect(result.issues[0]?.path).toEqual(path);
    expect(result.issues[0]?.path).not.toBe(path);
  });

  it.each([NaN, Infinity, -Infinity])(
    "rejects non-finite issue details consistently at both adapter boundaries (%s)", async (count) => {
      const issue = {
        category: "validation" as const, code: "notice", severity: "warning" as const,
        message: "Adapter notice.", details: { count }
      };
      const loaded = await loadConfigSources({
        context: undefined, loaders: [{
          descriptor: { id: "loader", kind: "adapter", priority: 0, displayName: "loader" },
          load: () => ({ value: {}, issues: [issue] })
        }]
      });
      const validation = await runValidators({
        config: {}, provenance: [], validators: [{
          id: "validator", validate: () => ({ ok: true, issues: [issue] })
        }]
      });

      expect(loaded.issues).toEqual([expect.objectContaining({ code: "invalid_loader_result", severity: "error" })]);
      expect(validation.issues).toEqual([expect.objectContaining({ code: "validator_issue_invalid", severity: "error" })]);
    }
  );

  it("accepts JSON-compatible detail primitives while keeping validator details private", async () => {
    const details = { count: 1.5, negative: -2, largest: Number.MAX_VALUE, zero: 0,
      label: "Adapter notice", enabled: true, absent: null };
    const issue = {
      category: "validation" as const, code: "notice", severity: "warning" as const,
      message: "Adapter notice.", details
    };
    const loaded = await loadConfigSources({
      context: undefined, loaders: [{
        descriptor: { id: "loader", kind: "adapter", priority: 0, displayName: "loader" },
        load: () => ({ value: {}, issues: [issue] })
      }]
    });
    const validation = await runValidators({
      config: {}, provenance: [], validators: [{
        id: "validator", validate: () => ({ ok: true, issues: [issue] })
      }]
    });

    expect(loaded.issues[0]?.details).toEqual(details);
    expect(loaded.issues[0]?.details).not.toBe(details);
    expect(validation.issues).toEqual([{
      category: "validation", code: "notice", severity: "warning", sourceId: "validator", validatorId: "validator",
      message: "Validator validator reported validation issue notice."
    }]);
  });

  it("shares the provenance budget between input history and new validator events", async () => {
    const history = [
      { path: ["port"], action: "defined" as const, sourceId: "defaults", message: "Defined port." },
      { path: ["enabled"], action: "defined" as const, sourceId: "defaults", message: "Defined enabled." }
    ];
    const invoked: string[] = [];
    const validation = await runValidators({
      config: { port: 3000, enabled: true }, provenance: history,
      limits: { maxProvenanceEvents: 3 },
      validators: ["first", "second"].map((id) => ({
        id,
        validate(input) {
          expect(input.provenance).toEqual(history);
          expect(input.provenance).not.toBe(history);
          invoked.push(id);
          return { ok: true, issues: [] };
        }
      }))
    });

    expect(invoked).toEqual(["first"]);
    expect(validation.provenance).toEqual([expect.objectContaining({ sourceId: "first", action: "validated" })]);
    expect(validation.issues).toEqual([expect.objectContaining({ code: "max_provenance_events_exceeded" })]);
    expect(history).toHaveLength(2);
    expect(Object.isFrozen(history)).toBe(false);
  });

  it.each([NaN, Infinity, -Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid numeric validator path segments (%s)", async (segment) => {
      const result = await runValidators({
        config: {}, provenance: [], validators: [{
          id: "path-check", validate: () => ({
            ok: false, issues: [{ code: "invalid", severity: "error", path: ["items", segment] }]
          })
        }]
      });
      expect(result.issues).toEqual([expect.objectContaining({ code: "validator_issue_invalid" })]);
    }
  );

  it("rejects sparse validator paths instead of letting holes bypass segment validation", async () => {
    const result = await runValidators({
      config: {}, provenance: [], validators: [{
        id: "path-check", validate: () => ({
          ok: false, issues: [{ code: "invalid", severity: "error", path: new Array<string>(1) }]
        })
      }]
    });
    expect(result.issues).toEqual([expect.objectContaining({ code: "validator_issue_invalid" })]);
  });

  it.each([0, 1, Number.MAX_SAFE_INTEGER, "0", "-1"])(
    "preserves valid validator path segments (%s)", async (segment) => {
      const result = await runValidators({
        config: {}, provenance: [], validators: [{
          id: "path-check", validate: () => ({
            ok: false, issues: [{ code: "invalid", severity: "error", path: ["items", segment] }]
          })
        }]
      });
      expect(result.issues).toEqual([
        expect.objectContaining({ code: "invalid", path: ["items", segment] })
      ]);
    }
  );

  it("normalizes validator failures into config issues", async () => {
    const result = resolveConfig({
      sources: [source("defaults", 0, { server: { port: 3000 } })]
    });
    const validation = await runValidators({
      config: result.config,
      provenance: result.provenance,
      validators: [
        {
          id: "throws",
          validate() {
            throw new Error("validator exploded with example-secret-value");
          }
        }
      ]
    });

    expect(validation.issues).toContainEqual({
      category: "validation",
      code: "validator_threw",
      severity: "error",
      sourceId: "throws", validatorId: "throws",
      message: "Validator throws threw an exception. Exception details were omitted from diagnostics."
    });
    expect(JSON.stringify(validation)).not.toContain("example-secret-value");
    expect(validation.provenance).toContainEqual({
      path: [],
      action: "validated",
      sourceId: "throws",
      message: "Validator throws failed."
    });
  });

  it("ignores untrusted validator message, details, and source identity", async () => {
    const result = resolveConfig({
      sources: [source("defaults", 0, { database: { password: "example-secret-value" } })]
    });
    const validation = await runValidators({
      config: result.config,
      provenance: result.provenance,
      validators: [
        {
          id: "root-check",
          validate() {
            return {
              ok: false,
              issues: [
                {
                  category: "validation",
                  code: "root_invalid",
                  severity: "error",
                  path: ["database", "password"],
                  sourceId: "spoofed-validator",
                  message: "Rejected example-secret-value.",
                  details: {
                    received: "example-secret-value"
                  }
                }
              ]
            };
          }
        }
      ]
    });

    expect(validation.issues).toEqual([
      {
        category: "validation",
        code: "root_invalid",
        severity: "error",
        path: ["database", "password"],
        sourceId: "root-check", validatorId: "root-check",
        message: "Validator root-check reported validation issue root_invalid."
      }
    ]);
    expect(JSON.stringify(validation)).not.toContain("example-secret-value");
  });

  it("rejects validator issue codes that can carry free-form diagnostic text", async () => {
    const result = resolveConfig({
      sources: [source("defaults", 0, { server: { port: 3000 } })]
    });
    const validation = await runValidators({
      config: result.config,
      provenance: result.provenance,
      validators: [
        {
          id: "malicious-code",
          validate() {
            return {
              ok: false,
              issues: [
                {
                  code: "token=validator-secret-value",
                  severity: "error",
                  path: ["server", "port"]
                }
              ]
            };
          }
        }
      ]
    });

    expect(validation.issues).toEqual([
      {
        category: "validation",
        code: "validator_issue_invalid",
        severity: "error",
        sourceId: "malicious-code", validatorId: "malicious-code",
        message: "Validator malicious-code returned invalid issue at index 0."
      }
    ]);
    expect(JSON.stringify(validation)).not.toContain("validator-secret-value");
  });

  it("does not apply validator returned values to the pipeline config", async () => {
    const result = resolveConfig({
      sources: [source("defaults", 0, { server: { port: 3000 } })]
    });
    const observedPorts: unknown[] = [];
    const validation = await runValidators({
      config: result.config,
      provenance: result.provenance,
      validators: [
        {
          id: "typed-output",
          validate() {
            return {
              ok: true,
              value: {
                server: {
                  port: 9000
                }
              },
              issues: []
            };
          }
        },
        {
          id: "observer",
          validate(input) {
            observedPorts.push(getConfigValueAtPath(input.config, ["server", "port"]));
            return {
              ok: true,
              value: input.config,
              issues: []
            };
          }
        }
      ]
    });

    expect(validation.issues).toEqual([]);
    expect(observedPorts).toEqual([3000]);
    expect(getConfigValueAtPath(result.config, ["server", "port"])).toBe(3000);
    expect(validation.provenance).toContainEqual({
      path: [],
      action: "validated",
      sourceId: "typed-output",
      message: "Validator typed-output completed with status ok."
    });
  });

  it("blocks validators from mutating the pipeline config object", async () => {
    const result = resolveConfig({
      sources: [source("defaults", 0, { server: { port: 3000 } })]
    });
    const validation = await runValidators({
      config: result.config,
      provenance: result.provenance,
      validators: [
        {
          id: "mutating-validator",
          validate(input) {
            (getConfigValueAtPath(input.config, ["server"]) as { port: number }).port = 9000;
            return {
              ok: true,
              value: input.config,
              issues: []
            };
          }
        }
      ]
    });

    expect(validation.issues).toContainEqual(
      expect.objectContaining({
        category: "validation",
        code: "validator_threw",
        sourceId: "mutating-validator"
      })
    );
    expect(getConfigValueAtPath(result.config, ["server", "port"])).toBe(3000);
  });

  it("blocks validators from mutating pipeline provenance", async () => {
    const result = resolveConfig({
      sources: [source("defaults", 0, { public: true })]
    });
    const originalProvenance = structuredClone(result.provenance);
    const validation = await runValidators({
      config: result.config,
      provenance: result.provenance,
      validators: [
        {
          id: "mutating-provenance",
          validate(input) {
            (input.provenance[0] as { message: string }).message = "validator-provenance-secret";
            return { ok: true, issues: [] };
          }
        }
      ]
    });

    expect(validation.issues).toContainEqual(
      expect.objectContaining({
        category: "validation",
        code: "validator_threw",
        sourceId: "mutating-provenance"
      })
    );
    expect(result.provenance).toEqual(originalProvenance);
    expect(JSON.stringify({ result, validation })).not.toContain("validator-provenance-secret");
  });

  it("normalizes malformed validator results and issues", async () => {
    const result = resolveConfig({
      sources: [source("defaults", 0, { server: { port: 3000 } })]
    });
    const validation = await runValidators({
      config: result.config,
      provenance: result.provenance,
      validators: [
        {
          id: "malformed-issues",
          validate() {
            return {
              ok: false,
              issues: [
                {
                  category: "validation",
                  code: "custom_failure",
                  severity: "error",
                  path: ["server", "port"],
                  message: "Port failed custom validation."
                },
                {
                  category: "merge",
                  code: "wrong_category",
                  severity: "error",
                  message: "Wrong category."
                },
                "not-an-issue"
              ]
            } as unknown as ValidatorResult;
          }
        },
        {
          id: "malformed-result",
          validate() {
            return {
              ok: false
            } as unknown as ValidatorResult;
          }
        }
      ]
    });

    expect(validation.issues).toContainEqual({
      category: "validation",
      code: "custom_failure",
      severity: "error",
      path: ["server", "port"],
      sourceId: "malformed-issues", validatorId: "malformed-issues",
      message: "Validator malformed-issues reported validation issue custom_failure."
    });
    expect(validation.issues).toContainEqual({
      category: "validation",
      code: "validator_issue_invalid",
      severity: "error",
      sourceId: "malformed-issues", validatorId: "malformed-issues",
      message: "Validator malformed-issues returned invalid issue at index 1."
    });
    expect(validation.issues).toContainEqual({
      category: "validation",
      code: "validator_issue_invalid",
      severity: "error",
      sourceId: "malformed-issues", validatorId: "malformed-issues",
      message: "Validator malformed-issues returned invalid issue at index 2."
    });
    expect(validation.issues).toContainEqual({
      category: "validation",
      code: "validator_result_invalid",
      severity: "error",
      sourceId: "malformed-result", validatorId: "malformed-result",
      message: "Validator malformed-result returned an invalid result."
    });
    expect(validation.provenance).toContainEqual({
      path: [],
      action: "validated",
      sourceId: "malformed-result",
      message: "Validator malformed-result returned an invalid result."
    });
  });

  it("normalizes inconsistent validator status and issue results", async () => {
    const result = resolveConfig({
      sources: [source("defaults", 0, { server: { port: 3000 } })]
    });
    const validation = await runValidators({
      config: result.config,
      provenance: result.provenance,
      validators: [
        {
          id: "false-without-error",
          validate() {
            return {
              ok: false,
              issues: []
            };
          }
        },
        {
          id: "true-with-error",
          validate() {
            return {
              ok: true,
              issues: [
                {
                  category: "validation",
                  code: "custom_error",
                  severity: "error",
                  message: "Validator reported an error issue."
                }
              ]
            };
          }
        }
      ]
    });

    expect(validation.issues).toContainEqual({
      category: "validation",
      code: "validator_failed_without_issues",
      severity: "error",
      sourceId: "false-without-error", validatorId: "false-without-error",
      message: "Validator false-without-error returned ok false without any error issues."
    });
    expect(validation.issues).toContainEqual({
      category: "validation",
      code: "custom_error",
      severity: "error",
      sourceId: "true-with-error", validatorId: "true-with-error",
      message: "Validator true-with-error reported validation issue custom_error."
    });
    expect(validation.provenance).toContainEqual({
      path: [],
      action: "validated",
      sourceId: "false-without-error",
      message: "Validator false-without-error completed with status error."
    });
    expect(validation.provenance).toContainEqual({
      path: [],
      action: "validated",
      sourceId: "true-with-error",
      message: "Validator true-with-error completed with status error."
    });
  });

  it("bounds validator diagnostics with an overflow marker", async () => {
    const result = resolveConfig({
      sources: [source("defaults", 0, { server: { port: 3000 } })]
    });
    const validation = await runValidators({
      config: result.config,
      provenance: result.provenance,
      limits: {
        maxDiagnostics: 2
      },
      validators: [
        {
          id: "many-issues",
          validate() {
            return {
              ok: false,
              issues: [
                {
                  category: "validation",
                  code: "first_failure",
                  severity: "error",
                  message: "First failure."
                },
                {
                  category: "validation",
                  code: "second_failure",
                  severity: "error",
                  message: "Second failure."
                },
                {
                  category: "validation",
                  code: "third_failure",
                  severity: "error",
                  message: "Third failure."
                }
              ]
            };
          }
        }
      ]
    });

    expect(validation.issues).toEqual([
      {
        category: "validation",
        code: "first_failure",
        severity: "error",
        sourceId: "many-issues", validatorId: "many-issues",
        message: "Validator many-issues reported validation issue first_failure."
      },
      {
        category: "resource-limit",
        code: "max_diagnostics_exceeded",
        severity: "error",
        message: "Diagnostics exceeded the maximum of 2."
      }
    ]);
  });

  it("rejects oversized validator provenance before invoking validators", async () => {
    let invoked = false;
    const validation = await runValidators({
      config: {},
      provenance: [
        { path: ["one"], action: "defined", sourceId: "one", message: "one" },
        { path: ["two"], action: "defined", sourceId: "two", message: "two" }
      ],
      limits: { maxProvenanceEvents: 1 },
      validators: [{
        id: "must-not-run",
        validate() {
          invoked = true;
          return { ok: true, issues: [] };
        }
      }]
    });

    expect(invoked).toBe(false);
    expect(validation.issues).toContainEqual(expect.objectContaining({ code: "max_provenance_events_exceeded" }));
  });
});
