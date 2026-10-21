import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";
import { withTempDir } from "./helpers/temp-directory.js";

describe("runCli", () => {
  it("passes the declared diagnostic budget to dotenv parsing", async () => {
    await withTempDir(async dir => {
      await writeFile(join(dir, "config.env"), "invalid\n".repeat(1000));
      await writeFile(join(dir, "uce.json"), JSON.stringify({ limits: { maxDiagnostics: 2 },
        sources: [{ id: "dotenv", kind: "dotenv-file", priority: 0, path: "config.env" }] }));
      let stdout = "";
      const result = await runCli(["explain", "--config", "uce.json", "--json"], {
        cwd: dir, env: {}, stdout: text => { stdout += text; }, stderr() {}
      });
      expect(result.exitCode).not.toBe(0);
      expect(JSON.parse(stdout).issues.map((issue: { code: string }) => issue.code))
        .toEqual(["dotenv_invalid_line", "dotenv_issues_truncated"]);
    });
  });

  it("explains a JSON file plus process env override as JSON", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "config.json"), JSON.stringify({ server: { port: 3000 } }), "utf8");
      await writeFile(
        join(dir, "uce.json"),
        JSON.stringify({
          sources: [
            {
              id: "file",
              kind: "json-file",
              priority: 0,
              path: "config.json"
            },
            {
              id: "env",
              kind: "process-env",
              priority: 10,
              mappings: [
                {
                  externalName: "APP_PORT",
                  sourceKind: "process-env",
                  targetPath: ["server", "port"],
                  parseAs: "number"
                }
              ]
            }
          ]
        }),
        "utf8"
      );

      let stdout = "";
      const result = await runCli(["explain", "--config", "uce.json", "--json"], {
        cwd: dir,
        env: { APP_PORT: "8080" },
        stdout: (text) => {
          stdout += text;
        },
        stderr: () => {}
      });
      const report = JSON.parse(stdout) as {
        readonly command: string;
        readonly status: string;
        readonly resolvedPaths: readonly { readonly path: readonly string[]; readonly winningSourceId: string }[];
      };

      expect(result.exitCode).toBe(0);
      expect(report.command).toBe("explain");
      expect(report.status).toBe("ok");
      expect(report.resolvedPaths).toContainEqual(
        expect.objectContaining({
          path: ["server", "port"],
          winningSourceId: "env"
        })
      );
    });
  });

  it("passes argv source values only after the separator", async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        join(dir, "uce.json"),
        JSON.stringify({
          sources: [
            {
              id: "argv",
              kind: "argv",
              priority: 10,
              mappings: [
                {
                  externalName: "--port",
                  sourceKind: "argv",
                  targetPath: ["server", "port"],
                  parseAs: "number"
                }
              ]
            }
          ]
        }),
        "utf8"
      );

      let stdout = "";
      const result = await runCli(["explain", "--config", "uce.json", "--json", "--", "--port", "9000"], {
        cwd: dir,
        env: {},
        stdout: (text) => {
          stdout += text;
        },
        stderr: () => {}
      });
      const report = JSON.parse(stdout) as {
        readonly status: string;
        readonly resolvedPaths: readonly { readonly path: readonly string[]; readonly winningSourceId: string }[];
      };

      expect(result.exitCode).toBe(0);
      expect(report.status).toBe("ok");
      expect(report.resolvedPaths).toContainEqual(
        expect.objectContaining({
          path: ["server", "port"],
          winningSourceId: "argv"
        })
      );
    });
  });

  it("rejects duplicate argv source values after the separator", async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        join(dir, "uce.json"),
        JSON.stringify({
          sources: [
            {
              id: "argv",
              kind: "argv",
              priority: 10,
              mappings: [
                {
                  externalName: "--port",
                  sourceKind: "argv",
                  targetPath: ["server", "port"],
                  parseAs: "number"
                }
              ]
            }
          ]
        }),
        "utf8"
      );

      let stdout = "";
      const result = await runCli(["explain", "--config", "uce.json", "--json", "--", "--port", "9000", "--port=8080"], {
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
          readonly sourceId?: string;
          readonly path?: readonly (string | number)[];
        }[];
      };

      expect(result.exitCode).toBe(3);
      expect(report.status).toBe("error");
      expect(report.issues).toContainEqual(
        expect.objectContaining({
          category: "mapping",
          code: "argv_duplicate_argument",
          sourceId: "argv",
          path: ["server", "port"]
        })
      );
    });
  });

  it("treats secret override mappings as secret paths in explain output", async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        join(dir, "uce.json"),
        JSON.stringify({
          sources: [
            {
              id: "env",
              kind: "process-env",
              priority: 10,
              mappings: [
                {
                  externalName: "SERVICE_HEADER",
                  sourceKind: "process-env",
                  targetPath: ["service", "header"],
                  secret: true
                }
              ]
            }
          ]
        }),
        "utf8"
      );

      let stdout = "";
      const result = await runCli(["explain", "--config", "uce.json", "--json"], {
        cwd: dir,
        env: {
          SERVICE_HEADER: "example-secret-value"
        },
        stdout: (text) => {
          stdout += text;
        },
        stderr: () => {}
      });
      const report = JSON.parse(stdout) as {
        readonly status: string;
        readonly resolvedPaths: readonly {
          readonly path: readonly string[];
          readonly redacted: boolean;
          readonly redactionReason: string;
        }[];
      };

      expect(result.exitCode).toBe(0);
      expect(report.status).toBe("ok");
      expect(report.resolvedPaths).toContainEqual(
        expect.objectContaining({
          path: ["service", "header"],
          redacted: true,
          redactionReason: "secret-path"
        })
      );
      expect(stdout).not.toContain("example-secret-value");
    });
  });

  it("returns resource-limit failures when env and argv sources exceed declared entry limits", async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        join(dir, "uce.json"),
        JSON.stringify({
          sources: [
            {
              id: "env",
              kind: "process-env",
              priority: 10,
              maxEnvEntries: 1,
              mappings: []
            },
            {
              id: "argv",
              kind: "argv",
              priority: 20,
              maxArgvEntries: 1,
              mappings: []
            }
          ]
        }),
        "utf8"
      );

      let stdout = "";
      const result = await runCli(["explain", "--config", "uce.json", "--json", "--", "--one", "two"], {
        cwd: dir,
        env: { ONE: "1", TWO: "2" },
        stdout: (text) => {
          stdout += text;
        },
        stderr: () => {}
      });
      const report = JSON.parse(stdout) as {
        readonly issues: readonly { readonly category: string; readonly code: string }[];
      };

      expect(result.exitCode).toBe(3);
      expect(report.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ category: "resource-limit", code: "max_env_entries_exceeded" }),
          expect.objectContaining({ category: "resource-limit", code: "max_argv_entries_exceeded" })
        ])
      );
    });
  });

  it("applies opt-in unmapped env warnings inside the declared prefix", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "uce.json"), JSON.stringify({
        sources: [{
          id: "env",
          kind: "process-env",
          priority: 10,
          unmappedBehavior: "warning",
          unmappedPrefix: "APP_",
          mappings: [{
            externalName: "APP_PORT",
            sourceKind: "process-env",
            targetPath: ["server", "port"],
            parseAs: "number"
          }]
        }]
      }), "utf8");
      let stdout = "";
      const result = await runCli(["explain", "--config", "uce.json", "--json"], {
        cwd: dir,
        env: { APP_PORT: "8080", APP_TYPO: "secret-value", PATH: "ignored" },
        stdout: (text) => { stdout += text; },
        stderr: () => {}
      });
      const report = JSON.parse(stdout) as { readonly issues: readonly { readonly code: string; readonly severity: string }[] };

      expect(result.exitCode).toBe(0);
      expect(report.issues).toContainEqual(expect.objectContaining({ code: "unmapped_env_entry", severity: "warning" }));
      expect(stdout).not.toContain("secret-value");
    });
  });
});
