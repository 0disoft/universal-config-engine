import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";
import { withTempDir } from "./helpers/temp-directory.js";

describe("runCli", () => {
  it("rejects file sources outside the pipeline declaration directory", async () => {
    await withTempDir(async (dir) => {
      const projectDir = join(dir, "project");
      await mkdir(projectDir);
      await writeFile(join(dir, "secret.json"), JSON.stringify({ service: { token: "outside" } }), "utf8");
      await writeFile(
        join(projectDir, "uce.json"),
        JSON.stringify({
          sources: [
            {
              id: "file",
              kind: "json-file",
              priority: 0,
              path: "../secret.json"
            }
          ]
        }),
        "utf8"
      );

      let stdout = "";
      const result = await runCli(["explain", "--config", "uce.json", "--json"], {
        cwd: projectDir,
        env: {},
        stdout: (text) => {
          stdout += text;
        },
        stderr: () => {}
      });
      const report = JSON.parse(stdout) as {
        readonly status: string;
        readonly sources: readonly { readonly id: string; readonly status: string }[];
        readonly issues: readonly {
          readonly category: string;
          readonly code: string;
          readonly sourceId?: string;
          readonly path?: readonly (string | number)[];
        }[];
      };

      expect(result.exitCode).toBe(2);
      expect(report.status).toBe("error");
      expect(report.sources).toContainEqual(
        expect.objectContaining({
          id: "file",
          status: "failed"
        })
      );
      expect(report.issues).toContainEqual(
        expect.objectContaining({
          category: "source-load",
          code: "pipeline_file_source_path_outside_config_directory",
          sourceId: "file",
          path: ["sources", 0, "path"]
        })
      );
    });
  });

  it("allows absolute file source paths inside the pipeline declaration directory", async () => {
    await withTempDir(async (dir) => {
      const configPath = join(dir, "config.json");
      await writeFile(configPath, JSON.stringify({ server: { port: 3000 } }), "utf8");
      await writeFile(
        join(dir, "uce.json"),
        JSON.stringify({
          sources: [
            {
              id: "file",
              kind: "json-file",
              priority: 0,
              path: configPath
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
      const report = JSON.parse(stdout) as {
        readonly status: string;
        readonly resolvedPaths: readonly { readonly path: readonly string[]; readonly winningSourceId: string }[];
      };

      expect(result.exitCode).toBe(0);
      expect(report.status).toBe("ok");
      expect(report.resolvedPaths).toContainEqual(
        expect.objectContaining({
          path: ["server", "port"],
          winningSourceId: "file"
        })
      );
    });
  });

  it("rejects file sources that escape through a directory junction", async () => {
    await withTempDir(async (dir) => {
      const projectDir = join(dir, "project");
      const outsideDir = join(dir, "outside");
      await mkdir(projectDir);
      await mkdir(outsideDir);
      await writeFile(
        join(outsideDir, "secret.json"),
        JSON.stringify({ token: "junction-secret-value" }),
        "utf8"
      );
      await symlink(outsideDir, join(projectDir, "linked"), "junction");
      await writeFile(
        join(projectDir, "uce.json"),
        JSON.stringify({
          sources: [
            {
              id: "file",
              kind: "json-file",
              priority: 0,
              path: "linked/secret.json"
            }
          ]
        }),
        "utf8"
      );

      let stdout = "";
      const result = await runCli(["explain", "--config", "uce.json", "--json"], {
        cwd: projectDir,
        env: {},
        stdout: (text) => {
          stdout += text;
        },
        stderr: () => {}
      });
      const report = JSON.parse(stdout) as {
        readonly issues: readonly { readonly code: string; readonly sourceId?: string }[];
      };

      expect(result.exitCode).toBe(2);
      expect(report.issues).toContainEqual(
        expect.objectContaining({
          code: "pipeline_file_source_path_outside_config_directory",
          sourceId: "file"
        })
      );
      expect(stdout).not.toContain("junction-secret-value");
    });
  });

  it("allows an internal absolute source through a declaration directory alias", async () => {
    await withTempDir(async (dir) => {
      const projectDir = join(dir, "project");
      const aliasDir = join(dir, "project-alias");
      await mkdir(projectDir);
      await writeFile(join(projectDir, "config.json"), JSON.stringify({ server: { port: 3000 } }), "utf8");
      await writeFile(
        join(projectDir, "uce.json"),
        JSON.stringify({
          sources: [
            {
              id: "file",
              kind: "json-file",
              priority: 0,
              path: join(aliasDir, "config.json")
            }
          ]
        }),
        "utf8"
      );
      await symlink(projectDir, aliasDir, "junction");

      let stdout = "";
      const result = await runCli(["explain", "--config", "uce.json", "--json"], {
        cwd: aliasDir,
        env: {},
        stdout: (text) => {
          stdout += text;
        },
        stderr: () => {}
      });
      const report = JSON.parse(stdout) as {
        readonly status: string;
        readonly resolvedPaths: readonly { readonly path: readonly string[] }[];
      };

      expect(result.exitCode).toBe(0);
      expect(report.status).toBe("ok");
      expect(report.resolvedPaths).toContainEqual(
        expect.objectContaining({
          path: ["server", "port"]
        })
      );
    });
  });

  it("allows internal directory names that begin with two dots", async () => {
    await withTempDir(async (dir) => {
      const dottedDirectory = join(dir, "..config");
      await mkdir(dottedDirectory);
      await writeFile(join(dottedDirectory, "config.json"), JSON.stringify({ server: { port: 3000 } }), "utf8");
      await writeFile(
        join(dir, "uce.json"),
        JSON.stringify({
          sources: [
            {
              id: "file",
              kind: "json-file",
              priority: 0,
              path: "..config/config.json"
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
      const report = JSON.parse(stdout) as { readonly status: string };

      expect(result.exitCode).toBe(0);
      expect(report.status).toBe("ok");
    });
  });
});
