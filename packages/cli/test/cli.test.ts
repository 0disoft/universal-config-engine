import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/index.js";
import { loadPipelineDeclaration } from "../src/pipeline.js";

async function withTempDir<T>(callback: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "uce-cli-"));
  try {
    return await callback(dir);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

describe("loadPipelineDeclaration", () => {
  it("rebuilds validated declarations instead of returning the parsed JSON object", async () => {
    await withTempDir(async (dir) => {
      const configPath = join(dir, "uce.json");
      await writeFile(configPath, "{}", "utf8");
      const parsed = {
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
        ],
        limits: {
          maxDiagnostics: 10
        }
      };
      const parse = vi.spyOn(JSON, "parse").mockReturnValue(parsed);

      try {
        const declaration = await loadPipelineDeclaration(configPath, dir);

        expect(declaration).toEqual(parsed);
        expect(declaration).not.toBe(parsed);
        expect(declaration.sources).not.toBe(parsed.sources);
        expect(declaration.sources[0]).not.toBe(parsed.sources[0]);
        const source = declaration.sources[0];
        if (source?.kind !== "process-env") {
          throw new Error("Expected normalized process-env source.");
        }
        expect(source.mappings).not.toBe(parsed.sources[0]?.mappings);
        expect(source.mappings[0]?.targetPath).not.toBe(parsed.sources[0]?.mappings[0]?.targetPath);
      } finally {
        parse.mockRestore();
      }
    });
  });

  it("rejects oversized declarations before JSON parsing", async () => {
    await withTempDir(async (dir) => {
      const configPath = join(dir, "uce.json");
      await writeFile(configPath, `{"padding":"${"x".repeat(1024 * 1024)}"}`, "utf8");
      const parse = vi.spyOn(JSON, "parse");

      try {
        await expect(loadPipelineDeclaration(configPath, dir)).rejects.toMatchObject({
          issues: [
            expect.objectContaining({
              category: "resource-limit",
              code: "max_file_bytes_exceeded",
              sourceId: "cli:pipeline-declaration"
            })
          ]
        });
        let stdout = "";
        const result = await runCli(["explain", "--config", "uce.json", "--json"], {
          cwd: dir,
          env: {},
          stdout: (text) => {
            stdout += text;
          },
          stderr: () => {}
        });

        expect(result.exitCode).toBe(3);
        expect(parse).not.toHaveBeenCalled();
        parse.mockRestore();
        expect(JSON.parse(stdout)).toMatchObject({
          status: "error",
          issues: [
            {
              category: "resource-limit",
              code: "max_file_bytes_exceeded",
              severity: "error",
              sourceId: "cli:pipeline-declaration"
            }
          ]
        });
      } finally {
        parse.mockRestore();
      }
    });
  });
});

describe("runCli", () => {
  it("omits malformed pipeline parser exception text from JSON output", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "uce.json"), '{"secret":"pipeline-parser-secret-value", invalid', "utf8");

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
        readonly issues: readonly { readonly code: string; readonly message: string }[];
      };

      expect(result.exitCode).toBe(2);
      expect(report.issues).toEqual([
        expect.objectContaining({
          code: "pipeline_declaration_load_failed",
          message: "Failed to load pipeline declaration. Exception details were omitted from diagnostics."
        })
      ]);
      expect(stdout).not.toContain("pipeline-parser-secret-value");
    });
  });

  it("omits validator compiler exception text from JSON output", async () => {
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
          validators: [
            {
              id: "schema",
              kind: "json-schema-ajv",
              schema: {
                type: "validator-compiler-secret-value"
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
        readonly issues: readonly { readonly code: string; readonly message: string }[];
      };

      expect(result.exitCode).toBe(1);
      expect(report.issues).toEqual([
        expect.objectContaining({
          code: "validator_compile_failed",
          message: "Validator schema failed to compile. Exception details were omitted from diagnostics."
        })
      ]);
      expect(stdout).not.toContain("validator-compiler-secret-value");
    });
  });

  it("does not echo unknown CLI option text into usage reports", async () => {
    let stdout = "";
    const result = await runCli(
      ["validate", "--json", "--unknown=cli-option-secret-value"],
      {
        cwd: process.cwd(),
        env: {},
        stdout: (text) => {
          stdout += text;
        },
        stderr: () => {}
      }
    );

    expect(result.exitCode).toBe(4);
    expect(stdout).toContain('"message": "Unknown CLI option."');
    expect(stdout).not.toContain("cli-option-secret-value");
  });

  it("matches the local precedence golden explain report", async () => {
    const fixtureRoot = new URL("../fixtures/local-precedence/", import.meta.url);
    const expected = JSON.parse(
      await readFile(new URL("expected-explain.json", fixtureRoot), "utf8")
    ) as unknown;
    let stdout = "";
    const result = await runCli(["explain", "--config", "uce.json", "--json", "--", "--host", "0.0.0.0"], {
      cwd: fileURLToPath(fixtureRoot),
      env: {
        APP_PORT: "8080",
        FEATURE_CACHE: "true"
      },
      stdout: (text) => {
        stdout += text;
      },
      stderr: () => {}
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual(expected);
    expect(stdout).not.toContain("fixture-placeholder");
  });

  it("matches the coercion and validation golden report", async () => {
    const fixtureRoot = new URL("../fixtures/coercion-validation/", import.meta.url);
    const expected = JSON.parse(
      await readFile(new URL("expected-validate.json", fixtureRoot), "utf8")
    ) as unknown;
    let stdout = "";
    const result = await runCli(["validate", "--config", "uce.json", "--json"], {
      cwd: fileURLToPath(fixtureRoot),
      env: {},
      stdout: (text) => {
        stdout += text;
      },
      stderr: () => {}
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual(expected);
  });

  it("matches the validation failure golden report", async () => {
    const fixtureRoot = new URL("../fixtures/validation-failure/", import.meta.url);
    const expected = JSON.parse(
      await readFile(new URL("expected-validate.json", fixtureRoot), "utf8")
    ) as unknown;
    let stdout = "";
    const result = await runCli(["validate", "--config", "uce.json", "--json"], {
      cwd: fileURLToPath(fixtureRoot),
      env: {},
      stdout: (text) => {
        stdout += text;
      },
      stderr: () => {}
    });

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(stdout)).toEqual(expected);
  });

  it("matches the secret validation failure golden report without leaking raw values", async () => {
    const fixtureRoot = new URL("../fixtures/secret-validation-failure/", import.meta.url);
    const expected = JSON.parse(
      await readFile(new URL("expected-validate.json", fixtureRoot), "utf8")
    ) as unknown;
    let stdout = "";
    const result = await runCli(["validate", "--config", "uce.json", "--json"], {
      cwd: fileURLToPath(fixtureRoot),
      env: {},
      stdout: (text) => {
        stdout += text;
      },
      stderr: () => {}
    });

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(stdout)).toEqual(expected);
    expect(stdout).not.toContain("example-secret-value");
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

  it("matches the mapping failure golden report", async () => {
    const fixtureRoot = new URL("../fixtures/mapping-failure/", import.meta.url);
    const expected = JSON.parse(
      await readFile(new URL("expected-validate.json", fixtureRoot), "utf8")
    ) as unknown;
    let stdout = "";
    const result = await runCli(["validate", "--config", "uce.json", "--json"], {
      cwd: fileURLToPath(fixtureRoot),
      env: { APP_PORT: "not-a-number" },
      stdout: (text) => {
        stdout += text;
      },
      stderr: () => {}
    });

    expect(result.exitCode).toBe(3);
    expect(JSON.parse(stdout)).toEqual(expected);
  });

  it("matches the source-load failure golden report", async () => {
    const fixtureRoot = new URL("../fixtures/source-load-failure/", import.meta.url);
    const expected = JSON.parse(
      await readFile(new URL("expected-explain.json", fixtureRoot), "utf8")
    ) as unknown;
    let stdout = "";
    const result = await runCli(["explain", "--config", "uce.json", "--json"], {
      cwd: fileURLToPath(fixtureRoot),
      env: {},
      stdout: (text) => {
        stdout += text;
      },
      stderr: () => {}
    });

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(stdout)).toEqual(expected);
  });

  it("rejects malformed mappings, coercion rules, and validators before source loading", async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        join(dir, "uce.json"),
        JSON.stringify({
          sources: [
            {
              id: "env",
              kind: "process-env",
              priority: 0,
              displayName: 123,
              mappings: [
                {
                  externalName: "APP_PORT",
                  sourceKind: "argv",
                  targetPath: "server.port",
                  parseAs: "integer"
                },
                {
                  externalName: "APP_HOST",
                  sourceKind: "process-env",
                  targetPath: ["server", 0, "host"]
                }
              ]
            }
          ],
          coercionRules: [
            {
              path: ["servers", 0, "port"],
              from: "number",
              to: "date",
              onFailure: "throw"
            }
          ],
          validators: [
            {
              id: "schema",
              kind: "zod",
              schema: "not-a-schema"
            }
          ]
        }),
        "utf8"
      );

      let stdout = "";
      const result = await runCli(["validate", "--config", "uce.json", "--json"], {
        cwd: dir,
        env: {
          APP_PORT: "8080"
        },
        stdout: (text) => {
          stdout += text;
        },
        stderr: () => {}
      });
      const report = JSON.parse(stdout) as {
        readonly status: string;
        readonly issues: readonly { readonly code: string; readonly category: string }[];
      };
      const issueCodes = report.issues.map((issue) => issue.code);

      expect(result.exitCode).toBe(2);
      expect(report.status).toBe("error");
      expect(issueCodes).toEqual(
        expect.arrayContaining([
          "pipeline_override_mapping_source_kind_invalid",
          "pipeline_override_mapping_target_path_invalid",
          "pipeline_override_mapping_parse_as_invalid",
          "pipeline_source_display_name_invalid",
          "pipeline_coercion_rule_path_invalid",
          "pipeline_coercion_rule_from_invalid",
          "pipeline_coercion_rule_to_invalid",
          "pipeline_coercion_rule_on_failure_invalid",
          "pipeline_validator_kind_invalid",
          "pipeline_validator_schema_invalid"
        ])
      );
      expect(report.issues.every((issue) => issue.category === "source-load")).toBe(true);
    });
  });

  it("rejects duplicate override target paths before source loading", async () => {
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
                },
                {
                  externalName: "PORT",
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
        env: {
          APP_PORT: "8080",
          PORT: "9000"
        },
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
          readonly path?: readonly (string | number)[];
          readonly sourceId?: string;
        }[];
      };

      expect(result.exitCode).toBe(2);
      expect(report.status).toBe("error");
      expect(report.issues).toContainEqual(
        expect.objectContaining({
          category: "source-load",
          code: "pipeline_override_mapping_target_path_duplicate",
          sourceId: "env",
          path: ["sources", 0, "mappings", 1, "targetPath"]
        })
      );
    });
  });

  it("rejects ancestor and descendant override target paths before source loading", async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        join(dir, "uce.json"),
        JSON.stringify({
          sources: [
            {
              id: "parent-first",
              kind: "process-env",
              priority: 10,
              mappings: [
                {
                  externalName: "SERVICE",
                  sourceKind: "process-env",
                  targetPath: ["service"],
                  parseAs: "json"
                },
                {
                  externalName: "PORT",
                  sourceKind: "process-env",
                  targetPath: ["service", "port"],
                  parseAs: "number"
                }
              ]
            },
            {
              id: "child-first",
              kind: "process-env",
              priority: 20,
              mappings: [
                {
                  externalName: "PORT",
                  sourceKind: "process-env",
                  targetPath: ["service", "port"],
                  parseAs: "number"
                },
                {
                  externalName: "SERVICE",
                  sourceKind: "process-env",
                  targetPath: ["service"],
                  parseAs: "json"
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
      expect(report.issues.filter((issue) => issue.code === "pipeline_override_mapping_target_path_overlap"))
        .toEqual([
          expect.objectContaining({ sourceId: "parent-first" }),
          expect.objectContaining({ sourceId: "child-first" })
        ]);
    });
  });

  it("rejects malformed resource limits and file size policies before source loading", async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        join(dir, "uce.json"),
        JSON.stringify({
          sources: [
            {
              id: "file",
              kind: "json-file",
              priority: 0,
              path: "config.json",
              maxFileBytes: "large"
            },
            {
              id: "env",
              kind: "dotenv-file",
              priority: 1,
              path: ".env",
              maxFileBytes: 0
            },
            {
              id: "process-env",
              kind: "process-env",
              priority: 2,
              mappings: [],
              maxEnvEntries: 0
            },
            {
              id: "argv",
              kind: "argv",
              priority: 3,
              mappings: [],
              maxArgvEntries: "many"
            }
          ],
          limits: {
            maxDepth: "deep",
            maxKeyCount: 0,
            maxPathLength: -1,
            maxDiagnostics: 1.5
          }
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
        readonly issues: readonly {
          readonly category: string;
          readonly code: string;
          readonly path: readonly (string | number)[];
          readonly sourceId?: string;
        }[];
      };
      const issueCodes = report.issues.map((issue) => issue.code);

      expect(result.exitCode).toBe(2);
      expect(report.status).toBe("error");
      expect(issueCodes).toEqual(
        expect.arrayContaining([
          "pipeline_file_source_max_file_bytes_invalid",
          "pipeline_process_env_max_entries_invalid",
          "pipeline_argv_max_entries_invalid",
          "pipeline_limit_value_invalid"
        ])
      );
      expect(report.issues).toContainEqual(
        expect.objectContaining({
          code: "pipeline_file_source_max_file_bytes_invalid",
          sourceId: "file",
          path: ["sources", 0, "maxFileBytes"]
        })
      );
      expect(report.issues).toContainEqual(
        expect.objectContaining({
          code: "pipeline_file_source_max_file_bytes_invalid",
          sourceId: "env",
          path: ["sources", 1, "maxFileBytes"]
        })
      );
      expect(report.issues).toContainEqual(
        expect.objectContaining({
          code: "pipeline_limit_value_invalid",
          path: ["limits", "maxDepth"]
        })
      );
      expect(report.issues).toContainEqual(
        expect.objectContaining({
          code: "pipeline_process_env_max_entries_invalid",
          sourceId: "process-env",
          path: ["sources", 2, "maxEnvEntries"]
        })
      );
      expect(report.issues).toContainEqual(
        expect.objectContaining({
          code: "pipeline_argv_max_entries_invalid",
          sourceId: "argv",
          path: ["sources", 3, "maxArgvEntries"]
        })
      );
      expect(report.issues).toContainEqual(
        expect.objectContaining({
          code: "pipeline_limit_value_invalid",
          path: ["limits", "maxDiagnostics"]
        })
      );
      expect(report.issues.every((issue) => issue.category === "source-load")).toBe(true);
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

  it("rejects unknown declaration fields and malformed redaction policy before source loading", async () => {
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
                database: {
                  password: "example-secret-value"
                }
              },
              redaction: {
                secretSource: "yes",
                secretPaths: ["database.password"],
                secretNamePatterns: ["password", ""],
                note: "ignored"
              },
              extraSourceField: true
            },
            {
              id: "env",
              kind: "process-env",
              priority: 10,
              mappings: [
                {
                  externalName: "DATABASE_PASSWORD",
                  sourceKind: "process-env",
                  targetPath: ["database", "password"],
                  secret: "yes",
                  note: "ignored"
                }
              ]
            }
          ],
          limits: {
            maxDepth: 8,
            maxKeys: 100
          },
          coercionRules: [
            {
              path: ["server", "port"],
              from: "string",
              to: "number",
              onFailure: "issue",
              note: "ignored"
            }
          ],
          validators: [
            {
              id: "schema",
              kind: "json-schema-ajv",
              schema: true,
              module: "./validator.js"
            }
          ],
          pipelineVersion: 1
        }),
        "utf8"
      );

      let stdout = "";
      const result = await runCli(["validate", "--config", "uce.json", "--json"], {
        cwd: dir,
        env: {
          DATABASE_PASSWORD: "example-secret-value"
        },
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
          readonly path: readonly (string | number)[];
          readonly sourceId?: string;
        }[];
      };
      const issueCodes = report.issues.map((issue) => issue.code);

      expect(result.exitCode).toBe(2);
      expect(report.status).toBe("error");
      expect(issueCodes).toEqual(
        expect.arrayContaining([
          "pipeline_unknown_field",
          "pipeline_source_unknown_field",
          "pipeline_redaction_policy_unknown_field",
          "pipeline_redaction_secret_source_invalid",
          "pipeline_redaction_secret_paths_invalid",
          "pipeline_redaction_secret_name_patterns_invalid",
          "pipeline_override_mapping_unknown_field",
          "pipeline_override_mapping_secret_invalid",
          "pipeline_limits_unknown_field",
          "pipeline_coercion_rule_unknown_field",
          "pipeline_validator_unknown_field"
        ])
      );
      expect(report.issues).toContainEqual(
        expect.objectContaining({
          code: "pipeline_unknown_field",
          path: ["pipelineVersion"]
        })
      );
      expect(report.issues).toContainEqual(
        expect.objectContaining({
          code: "pipeline_source_unknown_field",
          sourceId: "defaults",
          path: ["sources", 0, "extraSourceField"]
        })
      );
      expect(report.issues).toContainEqual(
        expect.objectContaining({
          code: "pipeline_override_mapping_secret_invalid",
          sourceId: "env",
          path: ["sources", 1, "mappings", 0, "secret"]
        })
      );
      expect(report.issues).toContainEqual(
        expect.objectContaining({
          code: "pipeline_validator_unknown_field",
          sourceId: "schema",
          path: ["validators", 0, "module"]
        })
      );
      expect(stdout).not.toContain("example-secret-value");
      expect(report.issues.every((issue) => issue.category === "source-load")).toBe(true);
    });
  });

  it("rejects duplicate source and validator ids before source loading", async () => {
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
                  port: 3000
                }
              }
            },
            {
              id: "defaults",
              kind: "object",
              priority: 10,
              value: {
                server: {
                  host: "127.0.0.1"
                }
              }
            }
          ],
          validators: [
            {
              id: "schema:server",
              kind: "json-schema-ajv",
              schema: true
            },
            {
              id: "schema:server",
              kind: "json-schema-ajv",
              schema: true
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
          readonly sourceId?: string;
          readonly path?: readonly (string | number)[];
        }[];
      };

      expect(result.exitCode).toBe(2);
      expect(report.status).toBe("error");
      expect(report.issues).toContainEqual(
        expect.objectContaining({
          category: "source-load",
          code: "pipeline_source_id_duplicate",
          sourceId: "defaults",
          path: ["sources", 1, "id"]
        })
      );
      expect(report.issues).toContainEqual(
        expect.objectContaining({
          category: "source-load",
          code: "pipeline_validator_id_duplicate",
          sourceId: "schema:server",
          path: ["validators", 1, "id"]
        })
      );
      expect(report.issues.every((issue) => issue.category === "source-load")).toBe(true);
    });
  });

  it("rejects source and validator id namespace collisions before source loading", async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        join(dir, "uce.json"),
        JSON.stringify({
          sources: [
            {
              id: "schema:server",
              kind: "object",
              priority: 0,
              value: {
                server: {
                  port: 3000
                }
              }
            }
          ],
          validators: [
            {
              id: "schema:server",
              kind: "json-schema-ajv",
              schema: true
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
          readonly sourceId?: string;
          readonly path?: readonly (string | number)[];
        }[];
      };

      expect(result.exitCode).toBe(2);
      expect(report.status).toBe("error");
      expect(report.issues).toContainEqual(
        expect.objectContaining({
          category: "source-load",
          code: "pipeline_declaration_id_namespace_collision",
          sourceId: "schema:server",
          path: ["validators", 0, "id"]
        })
      );
      expect(report.issues.every((issue) => issue.category === "source-load")).toBe(true);
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
                required: ["service", "database", "features"]
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

  it("matches the usage error golden report when JSON output is requested", async () => {
    const fixtureRoot = new URL("../fixtures/usage-error/", import.meta.url);
    const expected = JSON.parse(
      await readFile(new URL("expected-validate.json", fixtureRoot), "utf8")
    ) as unknown;
    let stdout = "";
    let stderr = "";
    const result = await runCli(["validate", "--json"], {
      cwd: process.cwd(),
      env: {},
      stdout: (text) => {
        stdout += text;
      },
      stderr: (text) => {
        stderr += text;
      }
    });

    expect(result.exitCode).toBe(4);
    expect(JSON.parse(stdout)).toEqual(expected);
    expect(stderr).toBe("");
  });
});
