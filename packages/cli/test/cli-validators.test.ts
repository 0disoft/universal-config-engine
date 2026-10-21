import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";
import { withTempDir } from "./helpers/temp-directory.js";

describe("runCli", () => {
  it("keeps validator setup failures within the declared diagnostics limit", async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        join(dir, "uce.json"),
        JSON.stringify({
          sources: [
            {
              id: "defaults",
              kind: "object",
              priority: 0,
              value: {}
            }
          ],
          validators: Array.from({ length: 3 }, (_, index) => ({
            id: `schema-${index}`,
            kind: "json-schema-ajv",
            schema: { type: `invalid-type-${index}` }
          })),
          limits: { maxDiagnostics: 1 }
        }),
        "utf8"
      );

      let stdout = "";
      const result = await runCli(["validate", "--config", "uce.json", "--json"], {
        cwd: dir,
        env: {},
        stdout: (text) => {
          stdout += text;
        },
        stderr: () => {}
      });
      const report = JSON.parse(stdout) as {
        readonly issues: readonly { readonly category: string; readonly code: string }[];
      };

      expect(result.exitCode).toBe(3);
      expect(report.issues).toEqual([
        expect.objectContaining({
          category: "resource-limit",
          code: "max_diagnostics_exceeded"
        })
      ]);
    });
  });

  it("runs declared Ajv JSON Schema validators for validate", async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        join(dir, "uce.json"),
        JSON.stringify({
          sources: [
            {
              id: "defaults",
              kind: "object",
              priority: 0,
              value: {
                server: {
                  port: 80
                }
              }
            }
          ],
          validators: [
            {
              id: "schema:server",
              kind: "json-schema-ajv",
              schema: {
                type: "object",
                required: ["server"],
                properties: {
                  server: {
                    type: "object",
                    required: ["port"],
                    properties: {
                      port: {
                        type: "integer",
                        minimum: 1024
                      }
                    }
                  }
                }
              }
            }
          ]
        }),
        "utf8"
      );

      let stdout = "";
      const result = await runCli(["validate", "--config", "uce.json", "--json"], {
        cwd: dir,
        env: {},
        stdout: (text) => {
          stdout += text;
        },
        stderr: () => {}
      });
      const report = JSON.parse(stdout) as {
        readonly status: string;
        readonly issues: readonly {
          readonly category: string;
          readonly code: string;
          readonly sourceId: string;
          readonly path: readonly (string | number)[];
        }[];
        readonly provenance: readonly { readonly action: string; readonly sourceId: string }[];
      };

      expect(result.exitCode).toBe(1);
      expect(report.status).toBe("error");
      expect(report.issues).toContainEqual(
        expect.objectContaining({
          category: "validation",
          code: "minimum",
          sourceId: "schema:server",
          path: ["server", "port"]
        })
      );
      expect(report.provenance).toContainEqual(
        expect.objectContaining({
          action: "validated",
          sourceId: "schema:server"
        })
      );
    });
  });

  it("applies maxDiagnostics to declared validation output", async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        join(dir, "uce.json"),
        JSON.stringify({
          sources: [
            {
              id: "defaults",
              kind: "object",
              priority: 0,
              value: {}
            }
          ],
          limits: {
            maxDiagnostics: 2
          },
          validators: [
            {
              id: "schema:required",
              kind: "json-schema-ajv",
              schema: {
                type: "object",
                // Failed alternatives require multiple diagnostics even in first-error mode.
                anyOf: ["service", "database", "features"].map(property => ({ required: [property] }))
              }
            }
          ]
        }),
        "utf8"
      );

      let stdout = "";
      const result = await runCli(["validate", "--config", "uce.json", "--json"], {
        cwd: dir,
        env: {},
        stdout: (text) => {
          stdout += text;
        },
        stderr: () => {}
      });
      const report = JSON.parse(stdout) as {
        readonly status: string;
        readonly issues: readonly {
          readonly category: string;
          readonly code: string;
        }[];
      };

      expect(result.exitCode).toBe(3);
      expect(report.status).toBe("error");
      expect(report.issues).toHaveLength(2);
      expect(report.issues).toContainEqual(
        expect.objectContaining({
          category: "resource-limit",
          code: "max_diagnostics_exceeded"
        })
      );
    });
  });
});
