import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";

async function withTempDir<T>(callback: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "uce-cli-"));
  try {
    return await callback(dir);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

describe("runCli", () => {
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

  it("uses policy failure exit code for mapping failures", async () => {
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
      const result = await runCli(["validate", "--config", "uce.json", "--json"], {
        cwd: dir,
        env: { APP_PORT: "not-a-number" },
        stdout: (text) => {
          stdout += text;
        },
        stderr: () => {}
      });
      const report = JSON.parse(stdout) as {
        readonly status: string;
        readonly issues: readonly { readonly category: string; readonly code: string }[];
      };

      expect(result.exitCode).toBe(3);
      expect(report.status).toBe("error");
      expect(report.issues).toContainEqual(
        expect.objectContaining({
          category: "mapping",
          code: "mapping_parse_failed"
        })
      );
    });
  });

  it("does not include raw secret values in JSON output", async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        join(dir, "uce.json"),
        JSON.stringify({
          sources: [
            {
              id: "defaults",
              kind: "object",
              priority: 0,
              redaction: {
                secretPaths: [["database", "password"]]
              },
              value: {
                database: {
                  password: "example-secret-value"
                }
              }
            }
          ]
        }),
        "utf8"
      );

      let stdout = "";
      const result = await runCli(["explain", "--config", "uce.json", "--json"], {
        cwd: dir,
        env: {},
        stdout: (text) => {
          stdout += text;
        },
        stderr: () => {}
      });

      expect(result.exitCode).toBe(0);
      expect(stdout).not.toContain("example-secret-value");
      expect(stdout).toContain("secret-path");
    });
  });

  it("returns usage failure for missing config", async () => {
    let stderr = "";
    const result = await runCli(["explain"], {
      cwd: process.cwd(),
      env: {},
      stdout: () => {},
      stderr: (text) => {
        stderr += text;
      }
    });

    expect(result.exitCode).toBe(4);
    expect(stderr).toContain("Missing required --config path.");
  });
});
