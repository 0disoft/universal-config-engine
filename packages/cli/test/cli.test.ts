import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCliArgs, runCli } from "../src/index.js";
import { withTempDir } from "./helpers/temp-directory.js";

describe("runCli", () => {
  it.each(["validate", "explain"])("fails %s when the diagnostic report exceeds its byte budget", async (command) => {
    await withTempDir(async dir => {
      await writeFile(join(dir, "uce.json"), JSON.stringify({
        sources: [{ id: "file", kind: "object", priority: 0,
          value: Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`port${index}`, index])) }],
        limits: { maxReportBytes: 1024 }
      }));
      for (const output of [[], ["--json"]]) {
        let stdout = "";
        const result = await runCli([command, "--config", "uce.json", ...output], {
          cwd: dir, env: {}, stdout: text => { stdout += text; }, stderr: () => {}
        });
        expect(result.exitCode).toBe(3);
        expect(stdout).toContain("max_report_bytes_exceeded");
      }
    });
  });

  it.each(["--config", "-c", "--output"])(
    "does not consume a short option as the value of %s", async (option) => {
      let stdout = "";
      const result = await runCli(["validate", "--json", option, "-c"], {
        cwd: process.cwd(), env: {}, stdout: (text) => { stdout += text; }, stderr: () => {}
      });
      expect(result.exitCode).toBe(4);
      expect(JSON.parse(stdout).issues).toEqual([
        expect.objectContaining({ category: "usage", message: `Option ${option} requires a value.` })
      ]);
    }
  );

  it("accepts a config path beginning with a dash through explicit assignment", () => {
    expect(parseCliArgs(["validate", "--config=-c"]).configPath).toBe("-c");
  });

  it("escapes line breaks and terminal control characters in human output", async () => {
    await withTempDir(async (dir) => {
      const maliciousId = "source\nstatus: forged\u001b]52;c;YW5hbHlzaXM=\u0007";
      await writeFile(
        join(dir, "uce.json"),
        JSON.stringify({
          sources: [
            {
              id: maliciousId,
              kind: "object",
              priority: 0,
              value: { enabled: true }
            }
          ]
        }),
        "utf8"
      );

      let stdout = "";
      const result = await runCli(["explain", "--config", "uce.json"], {
        cwd: dir,
        env: {},
        stdout: (text) => {
          stdout += text;
        },
        stderr: () => {}
      });

      expect(result.exitCode).toBe(0);
      expect(stdout).not.toContain("\nstatus: forged");
      expect(stdout).not.toContain("\u001b");
      expect(stdout).not.toContain("\u0007");
      expect(stdout).toContain("source\\nstatus: forged\\u001b]52;c;YW5hbHlzaXM=\\u0007");
    });
  });

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

  it("shows source locations and bounded provenance in human explain output", async () => {
    const fixtureRoot = fileURLToPath(new URL("../fixtures/local-precedence/", import.meta.url));
    let stdout = "";
    const result = await runCli(
      ["explain", "--config", "uce.json", "--", "--host", "localhost"],
      {
        cwd: fixtureRoot,
        env: { APP_PORT: "8080", FEATURE_CACHE: "true" },
        stdout: (text) => { stdout += text; },
        stderr: () => {}
      }
    );

    expect(result.exitCode).toBe(0);
    expect(stdout).toContain("at=defaults.json:5:19");
    expect(stdout).toContain("overriddenAt=defaults.json:4:13");
    expect(stdout).toContain("provenance:\n");
    expect(stdout).toContain("overridden service.port source=runtime-env previous=defaults");
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
