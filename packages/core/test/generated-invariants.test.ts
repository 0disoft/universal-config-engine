import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  buildDiagnosticReport,
  createMappedOverrideSource,
  getConfigValueAtPath,
  runConfigPipeline,
  runValidators,
  resolveConfig
} from "../src/index.js";
import type {
  ConfigIssue,
  ConfigLoader,
  ConfigPath,
  ConfigValue,
  LoadedSource,
  ValidatorAdapter
} from "../src/index.js";

const GENERATED_PARAMETERS = {
  seed: 0x5eed2026,
  numRuns: 100
} as const;

const safeCharacter = fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789_");
const safeKey = fc
  .array(safeCharacter, { minLength: 1, maxLength: 10 })
  .map((characters) => characters.join(""))
  .filter((value) => value !== "constructor" && value !== "prototype" && value !== "__proto__");
const safeText = fc
  .array(safeCharacter, { minLength: 0, maxLength: 16 })
  .map((characters) => characters.join(""));
const scalarValue: fc.Arbitrary<ConfigValue> = fc.oneof(
  fc.integer({ min: -10_000, max: 10_000 }),
  fc.boolean(),
  fc.constant(null),
  safeText
);
const safePath = fc.array(safeKey, { minLength: 1, maxLength: 6 });

function source(id: string, priority: number, value: unknown): LoadedSource {
  return {
    descriptor: {
      id,
      kind: "object",
      priority,
      displayName: id
    },
    value
  };
}

describe("generated core invariants", () => {
  it("keeps priority, final values, and provenance stable across source declaration order", () => {
    const entries = fc.uniqueArray(
      fc.record({ key: safeKey, lower: scalarValue, higher: scalarValue }),
      { minLength: 1, maxLength: 20, selector: (entry) => entry.key }
    );

    fc.assert(
      fc.property(entries, (values) => {
        const lower = Object.fromEntries(values.map((entry) => [entry.key, entry.lower]));
        const higher = Object.fromEntries(values.map((entry) => [entry.key, entry.higher]));
        const ordered = resolveConfig({
          sources: [source("lower", 0, lower), source("higher", 10, higher)]
        });
        const reversed = resolveConfig({
          sources: [source("higher", 10, higher), source("lower", 0, lower)]
        });

        expect(ordered.ok).toBe(true);
        expect(reversed.config).toEqual(ordered.config);
        expect(reversed.resolvedPaths).toEqual(ordered.resolvedPaths);

        for (const entry of values) {
          expect(getConfigValueAtPath(ordered.config, [entry.key])).toEqual(entry.higher);
          expect(ordered.resolvedPaths).toContainEqual(
            expect.objectContaining({
              path: [entry.key],
              winningSourceId: "higher",
              overriddenSourceIds: ["lower"]
            })
          );
        }
      }),
      GENERATED_PARAMETERS
    );
  });

  it("rejects ancestor and descendant mapping targets in either declaration order", () => {
    fc.assert(
      fc.property(safePath, safeText, safeText, fc.boolean(), (path, first, second, reverse) => {
        const childPath: ConfigPath = [...path, "child"];
        const mappings = [
          {
            externalName: "FIRST",
            sourceKind: "process-env" as const,
            targetPath: path
          },
          {
            externalName: "SECOND",
            sourceKind: "process-env" as const,
            targetPath: childPath
          }
        ];
        const mapped = createMappedOverrideSource({
          descriptor: {
            id: "generated-env",
            kind: "process-env",
            priority: 10,
            displayName: "generated-env"
          },
          values: { FIRST: first, SECOND: second },
          mappings: reverse ? [...mappings].reverse() : mappings
        });
        const result = resolveConfig({ sources: [mapped] });

        expect(mapped.issues).toContainEqual(
          expect.objectContaining({ code: "overlapping_mapping_target_path" })
        );
        expect(result.ok).toBe(false);
        expect(result.config).toEqual({});
      }),
      GENERATED_PARAMETERS
    );
  });

  it("enforces aggregate key limits after generated JSON coercion", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 40 }), (keyCount) => {
        const payload = Object.fromEntries(
          Array.from({ length: keyCount }, (_, index) => [`key_${index}`, index])
        );
        const raw = JSON.stringify(payload);
        const original = { payload: raw };
        const result = resolveConfig({
          sources: [source("generated-json", 0, original)],
          coercionRules: [{
            path: ["payload"],
            from: "string",
            to: "json",
            onFailure: "issue"
          }],
          limits: { maxKeyCount: keyCount - 1 }
        });

        expect(result.ok).toBe(false);
        expect(result.issues).toContainEqual(
          expect.objectContaining({
            code: "max_key_count_exceeded",
            sourceId: "core:resolved-config"
          })
        );
        expect(original).toEqual({ payload: raw });
      }),
      GENERATED_PARAMETERS
    );
  });

  it("redacts generated secret subtrees and treats name patterns literally", () => {
    const secretToken = fc
      .array(safeCharacter, { minLength: 8, maxLength: 20 })
      .map((characters) => `private_${characters.join("")}_value`);
    const literalPattern = fc
      .array(fc.constantFrom(".", "*", "+", "?", "[", "]", "(", ")", "|", "^", "$"), {
        minLength: 1,
        maxLength: 4
      })
      .map((characters) => characters.join(""));

    fc.assert(
      fc.property(secretToken, literalPattern, (secret, pattern) => {
        const baseSource = source("generated-secret", 0, {
          secret: { token: secret },
          [`prefix_${pattern}_suffix`]: "visible"
        });
        const secretSource: LoadedSource = {
          ...baseSource,
          descriptor: {
            ...baseSource.descriptor,
            redaction: {
              secretPaths: [["secret"]],
              secretNamePatterns: [pattern]
            }
          }
        };
        const resolved = resolveConfig({ sources: [secretSource] });
        const rawIssue: ConfigIssue = {
          category: "validation",
          code: "generated_secret_issue",
          severity: "error",
          sourceId: "generated-secret",
          path: ["secret", "token"],
          message: secret,
          details: { value: secret }
        };
        const report = buildDiagnosticReport({
          ...resolved,
          ok: false,
          issues: [rawIssue]
        });
        const serialized = JSON.stringify(report);

        expect(serialized).not.toContain(secret);
        expect(report.resolvedPaths).toContainEqual(
          expect.objectContaining({ path: ["secret", "token"], redacted: true })
        );
        expect(report.resolvedPaths).toContainEqual(
          expect.objectContaining({ path: [`prefix_${pattern}_suffix`], redacted: true })
        );
      }),
      GENERATED_PARAMETERS
    );
  });

  it("normalizes malformed loaders and bounds generated validator diagnostics", async () => {
    await fc.assert(
      fc.asyncProperty(
        safeText,
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 2, max: 20 }),
        async (invalidCode, maxDiagnostics, issueCount) => {
          const malformedLoader: ConfigLoader = {
            descriptor: {
              id: "generated-loader",
              kind: "adapter",
              priority: 0,
              displayName: "generated-loader"
            },
            load() {
              return {
                value: {},
                issues: [{ code: invalidCode }]
              } as unknown as Awaited<ReturnType<ConfigLoader["load"]>>;
            }
          };
          const pipeline = await runConfigPipeline({
            loaders: [malformedLoader],
            context: undefined,
            limits: { maxDiagnostics }
          });
          expect(pipeline.result.issues).toContainEqual(
            expect.objectContaining({ code: "invalid_loader_result" })
          );
          expect(pipeline.result.issues.length).toBeLessThanOrEqual(maxDiagnostics);

          const validator: ValidatorAdapter = {
            id: "generated-validator",
            validate() {
              return {
                ok: false,
                issues: Array.from({ length: issueCount }, (_, index) => ({
                  code: `issue_${index}`,
                  severity: "error" as const
                }))
              };
            }
          };
          const validation = await runValidators({
            config: {},
            provenance: [],
            validators: [validator],
            limits: { maxDiagnostics }
          });
          expect(validation.issues.length).toBeLessThanOrEqual(maxDiagnostics);
          if (issueCount > maxDiagnostics) {
            expect(validation.issues.at(-1)).toEqual(
              expect.objectContaining({ code: "max_diagnostics_exceeded" })
            );
          }
        }
      ),
      GENERATED_PARAMETERS
    );
  });

  it("isolates generated validator mutation attempts from later validators", async () => {
    await fc.assert(
      fc.asyncProperty(safeKey, scalarValue, async (key, value) => {
        const config: ConfigValue = { [key]: value };
        let observed: ConfigValue | undefined;
        const mutating: ValidatorAdapter = {
          id: "mutating",
          validate(input) {
            (input.config as Record<string, ConfigValue>)[key] = "changed";
            return { ok: true, issues: [] };
          }
        };
        const observing: ValidatorAdapter = {
          id: "observing",
          validate(input) {
            observed = getConfigValueAtPath(input.config, [key]);
            return { ok: true, issues: [] };
          }
        };
        const validation = await runValidators({
          config,
          provenance: [],
          validators: [mutating, observing]
        });

        expect(getConfigValueAtPath(config, [key])).toEqual(value);
        expect(observed).toEqual(value);
        expect(validation.issues).toContainEqual(
          expect.objectContaining({ code: "validator_threw", sourceId: "mutating" })
        );
      }),
      GENERATED_PARAMETERS
    );
  });
});
