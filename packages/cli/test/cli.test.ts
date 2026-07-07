import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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

  it("rejects unsupported source kinds at the pipeline declaration boundary", async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        join(dir, "uce.json"),
        JSON.stringify({
          sources: [
            {
              id: "yaml",
              kind: "yaml-file",
              priority: 0,
              path: "config.yaml"
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
        readonly issues: readonly {
          readonly category: string;
          readonly code: string;
          readonly sourceId: string;
          readonly path: readonly (string | number)[];
        }[];
      };

      expect(result.exitCode).toBe(2);
      expect(report.status).toBe("error");
      expect(report.issues).toContainEqual({
        category: "source-load",
        code: "unsupported_source_kind",
        severity: "error",
        sourceId: "yaml",
        path: ["sources", 0, "kind"],
        message: "Unsupported source kind yaml-file."
      });
    });
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
              mappings: [
                {
                  externalName: "APP_PORT",
                  sourceKind: "argv",
                  targetPath: "server.port",
                  parseAs: "integer"
                }
              ]
            }
          ],
          coercionRules: [
            {
              path: [],
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
          code: "pipeline_limit_value_invalid",
          path: ["limits", "maxDiagnostics"]
        })
      );
      expect(report.issues.every((issue) => issue.category === "source-load")).toBe(true);
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
