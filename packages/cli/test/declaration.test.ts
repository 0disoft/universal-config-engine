import {
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";
import {
  describe,
  expect,
  it,
  vi
} from "vitest";
import { runCli } from "../src/index.js";
import { loadDeclaredSources, loadPipelineDeclaration, loadPipelineDeclarationContext } from "../src/pipeline.js";
import { withTempDir } from "./helpers/temp-directory.js";

describe("loadPipelineDeclaration", () => {
  it("bounds malformed declaration diagnostics with a bootstrap limit", async () => {
    await withTempDir(async (dir) => {
      const configPath = join(dir, "uce.json");
      const unknownFields = Object.fromEntries(
        Array.from({ length: 10_000 }, (_, index) => [`x${index}`, true])
      );
      await writeFile(
        configPath,
        JSON.stringify({ sources: [], ...unknownFields }),
        "utf8"
      );

      await expect(loadPipelineDeclaration(configPath, dir)).rejects.toMatchObject({
        issues: expect.arrayContaining([
          expect.objectContaining({
            category: "resource-limit",
            code: "max_diagnostics_exceeded"
          })
        ])
      });
      try {
        await loadPipelineDeclaration(configPath, dir);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as { issues: readonly unknown[] }).issues).toHaveLength(200);
      }
    });
  });

  it("keeps relative sources bound to the declaration file that was opened", async () => {
    await withTempDir(async (dir) => {
      const directoryA = join(dir, "A");
      const directoryB = join(dir, "B");
      const aliasPath = join(dir, "uce.json");
      await mkdir(directoryA);
      await mkdir(directoryB);
      const declaration = JSON.stringify({
        sources: [
          {
            id: "payload",
            kind: "json-file",
            priority: 0,
            path: "payload.json"
          }
        ]
      });
      await writeFile(join(directoryA, "uce.json"), declaration, "utf8");
      await writeFile(join(directoryB, "uce.json"), declaration, "utf8");
      await writeFile(join(directoryA, "payload.json"), JSON.stringify({ origin: "A" }), "utf8");
      await writeFile(join(directoryB, "payload.json"), JSON.stringify({ origin: "B" }), "utf8");
      await symlink(join(directoryA, "uce.json"), aliasPath, "file");

      const context = await loadPipelineDeclarationContext(aliasPath, dir);
      await rm(aliasPath);
      await symlink(join(directoryB, "uce.json"), aliasPath, "file");
      const sources = await loadDeclaredSources({
        declaration: context.declaration,
        configPath: context.canonicalConfigPath,
        cwd: dir,
        env: {},
        argv: []
      });

      expect(sources[0]?.value).toEqual({ origin: "A" });
      expect(context.canonicalConfigPath).toBe(await realpath(join(directoryA, "uce.json")));
    });
  });

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
            maxDiagnostics: 1.5,
            maxReportBytes: 1
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

  it("rejects excess declared sources before loading them", async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        join(dir, "uce.json"),
        JSON.stringify({
          sources: [
            { id: "first", kind: "object", priority: 0, value: { first: true } },
            { id: "outside", kind: "json-file", priority: 1, path: "missing.json" }
          ],
          limits: { maxSources: 1 }
        }),
        "utf8"
      );

      let stdout = "";
      const result = await runCli(["explain", "--config", "uce.json", "--json"], {
        cwd: dir,
        env: {},
        stdout: (text) => { stdout += text; },
        stderr: () => {}
      });
      const report = JSON.parse(stdout) as { readonly issues: readonly { readonly code: string }[] };

      expect(result.exitCode).toBe(3);
      expect(report.issues).toContainEqual(expect.objectContaining({ code: "max_sources_exceeded" }));
      expect(report.issues).not.toContainEqual(expect.objectContaining({ code: "file_read_failed" }));
    });
  });

  it("rejects invalid unmapped input declarations before loading sources", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "uce.json"), JSON.stringify({
        sources: [
          { id: "env", kind: "process-env", priority: 1, unmappedBehavior: "error", mappings: [] },
          { id: "argv", kind: "argv", priority: 2, unmappedBehavior: "ignore", mappings: [] }
        ]
      }), "utf8");
      let stdout = "";
      const result = await runCli(["explain", "--config", "uce.json", "--json"], {
        cwd: dir,
        env: {},
        stdout: (text) => { stdout += text; },
        stderr: () => {}
      });
      const report = JSON.parse(stdout) as { readonly issues: readonly { readonly code: string }[] };

      expect(result.exitCode).toBe(2);
      expect(report.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "pipeline_unmapped_prefix_required" }),
        expect.objectContaining({ code: "pipeline_unmapped_behavior_invalid" })
      ]));
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
});
