import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "@0disoft/universal-config-engine-core";
import {
  createArgvSource,
  createProcessEnvSource,
  loadDotenvFileSource,
  loadJsonFileSource,
  parseSimpleDotenv,
  readTextFileWithinLimit
} from "../src/index.js";
import type { ConfigSourceDescriptor } from "@0disoft/universal-config-engine-core";

function descriptor(id: string, kind: ConfigSourceDescriptor["kind"], priority: number): ConfigSourceDescriptor {
  return {
    id,
    kind,
    priority,
    displayName: id
  };
}

describe("node source loaders", () => {
  it("returns the canonical identity of the opened bounded file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uce-file-canonical-"));
    try {
      const filePath = join(dir, "config.json");
      await writeFile(filePath, "{}", "utf8");

      const result = await readTextFileWithinLimit({
        filePath,
        sourceId: "config"
      });

      expect(result).toEqual({
        ok: true,
        raw: "{}",
        canonicalPath: await realpath(filePath)
      });
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("loads JSON files as source values", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uce-json-"));
    try {
      const filePath = join(dir, "config.json");
      await writeFile(filePath, JSON.stringify({ server: { port: 3000 } }), "utf8");

      const loaded = await loadJsonFileSource({
        descriptor: descriptor("json", "json-file", 1),
        filePath
      });
      const result = resolveConfig({ sources: [loaded] });

      expect(result.ok).toBe(true);
      expect(result.config).toEqual({ server: { port: 3000 } });
      expect(loaded.locations).toEqual(expect.arrayContaining([
        {
          path: ["server", "port"],
          location: {
            sourceId: "json",
            sourcePath: await realpath(filePath),
            line: 1,
            column: 19
          }
        }
      ]));
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("returns bounded issues for oversized JSON files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uce-json-large-"));
    try {
      const filePath = join(dir, "config.json");
      await writeFile(filePath, "{\"a\":true}", "utf8");

      const loaded = await loadJsonFileSource({
        descriptor: descriptor("json", "json-file", 1),
        filePath,
        maxFileBytes: 2
      });

      expect(loaded.issues).toContainEqual(
        expect.objectContaining({
          category: "resource-limit",
          code: "max_file_bytes_exceeded",
          sourceId: "json"
        })
      );
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("retains container locations without expanding array elements", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uce-json-locations-"));
    try {
      const filePath = join(dir, "config.json");
      await writeFile(filePath, '{"items":[{"id":1},{"id":2}]}', "utf8");
      const loaded = await loadJsonFileSource({
        descriptor: descriptor("json", "json-file", 1),
        filePath
      });

      expect(loaded.locations).toContainEqual(expect.objectContaining({ path: ["items"] }));
      expect(loaded.locations?.some((entry) => entry.path.some((segment) => typeof segment === "number")))
        .toBe(false);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("uses the default file bound when a runtime byte limit is invalid", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uce-json-invalid-limit-"));
    try {
      const filePath = join(dir, "config.json");
      await writeFile(filePath, `"${"x".repeat(1024 * 1024)}"`, "utf8");

      const loaded = await loadJsonFileSource({
        descriptor: descriptor("json", "json-file", 1),
        filePath,
        maxFileBytes: Number.NaN
      });

      expect(loaded.issues).toContainEqual(
        expect.objectContaining({
          category: "resource-limit",
          code: "max_file_bytes_exceeded",
          details: expect.objectContaining({ maxFileBytes: 1024 * 1024 })
        })
      );
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("omits malformed JSON parser exception text from issues", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uce-json-invalid-"));
    try {
      const filePath = join(dir, "config.json");
      await writeFile(filePath, '{"token":"json-parser-secret-value", invalid', "utf8");

      const loaded = await loadJsonFileSource({
        descriptor: descriptor("json", "json-file", 1),
        filePath
      });

      expect(loaded.issues).toEqual([
        {
          category: "parse",
          code: "json_parse_failed",
          severity: "error",
          sourceId: "json",
          message: "Failed to parse JSON source. Exception details were omitted from diagnostics."
        }
      ]);
      expect(JSON.stringify(loaded)).not.toContain("json-parser-secret-value");
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it.each([
    '{"enabled":true,}',
    '{"enabled":true /* comment */}'
  ])("keeps JSON file parsing strict for %s", async (raw) => {
    const dir = await mkdtemp(join(tmpdir(), "uce-json-strict-"));
    try {
      const filePath = join(dir, "config.json");
      await writeFile(filePath, raw, "utf8");
      const loaded = await loadJsonFileSource({
        descriptor: descriptor("json", "json-file", 1),
        filePath
      });
      expect(loaded.issues).toContainEqual(expect.objectContaining({ code: "json_parse_failed" }));
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("distinguishes JSON read failures from parse failures without exposing paths", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uce-json-missing-"));
    try {
      const loaded = await loadJsonFileSource({
        descriptor: descriptor("json", "json-file", 1),
        filePath: join(dir, "json-read-secret-value.json")
      });

      expect(loaded.issues).toEqual([
        {
          category: "source-load",
          code: "json_read_failed",
          severity: "error",
          sourceId: "json",
          message: "Failed to read JSON source. Exception details were omitted from diagnostics."
        }
      ]);
      expect(JSON.stringify(loaded)).not.toContain("json-read-secret-value");
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("refuses to read an opened file whose canonical path is outside the allowed root", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uce-json-boundary-"));
    try {
      const allowedRootPath = join(dir, "project");
      const outsideDirectory = join(dir, "outside");
      await mkdir(allowedRootPath);
      await mkdir(outsideDirectory);
      await writeFile(
        join(outsideDirectory, "config.json"),
        JSON.stringify({ token: "opened-file-secret-value" }),
        "utf8"
      );
      await symlink(outsideDirectory, join(allowedRootPath, "linked"), "junction");

      const loaded = await loadJsonFileSource({
        descriptor: descriptor("json", "json-file", 1),
        filePath: join(allowedRootPath, "linked", "config.json"),
        allowedRootPath
      });

      expect(loaded.issues).toEqual([
        {
          category: "source-load",
          code: "file_path_outside_allowed_root",
          severity: "error",
          sourceId: "json",
          message: "File source boundary verification failed before reading contents."
        }
      ]);
      expect(JSON.stringify(loaded)).not.toContain("opened-file-secret-value");
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("fails closed when the allowed root cannot be canonicalized", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uce-json-boundary-root-"));
    try {
      const filePath = join(dir, "config.json");
      await writeFile(filePath, JSON.stringify({ server: { port: 3000 } }), "utf8");

      const loaded = await loadJsonFileSource({
        descriptor: descriptor("json", "json-file", 1),
        filePath,
        allowedRootPath: join(dir, "missing-root")
      });

      expect(loaded.issues).toContainEqual(
        expect.objectContaining({
          category: "source-load",
          code: "file_boundary_verification_failed",
          sourceId: "json"
        })
      );
      expect(loaded.value).toEqual({});
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("accepts bounded files in directory names that begin with two dots", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uce-json-dotted-directory-"));
    try {
      const dottedDirectory = join(dir, "..config");
      await mkdir(dottedDirectory);
      const filePath = join(dottedDirectory, "config.json");
      await writeFile(filePath, JSON.stringify({ server: { port: 3000 } }), "utf8");

      const loaded = await loadJsonFileSource({
        descriptor: descriptor("json", "json-file", 1),
        filePath,
        allowedRootPath: dir
      });

      expect(loaded.issues ?? []).toEqual([]);
      expect(loaded.value).toEqual({ server: { port: 3000 } });
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("parses only simple dotenv KEY=VALUE lines", () => {
    const loaded = parseSimpleDotenv(
      descriptor("dotenv", "dotenv-file", 1),
      [
        "# comment",
        "APP_PORT=3000",
        "APP_NAME='demo'",
        "export BAD=ignored",
        "MULTILINE=line1\\nline2"
      ].join("\n")
    );

    expect(loaded.value).toEqual({
      APP_PORT: "3000",
      APP_NAME: "demo",
      MULTILINE: "line1\\nline2"
    });
    expect(loaded.issues).toContainEqual(
      expect.objectContaining({
        category: "parse",
        code: "dotenv_invalid_name"
      })
    );
  });

  it("does not echo malformed dotenv variable names", () => {
    const loaded = parseSimpleDotenv(
      descriptor("dotenv", "dotenv-file", 1),
      "dotenv-secret-value!=ignored"
    );

    expect(loaded.issues).toEqual([
      {
        category: "parse",
        code: "dotenv_invalid_name",
        severity: "error",
        sourceId: "dotenv",
        message: "Invalid dotenv variable name.",
        details: {
          line: 1
        }
      }
    ]);
    expect(JSON.stringify(loaded)).not.toContain("dotenv-secret-value");
  });

  it("retains the last dotenv location for repeated names", () => {
    const loaded = parseSimpleDotenv(
      descriptor("dotenv", "dotenv-file", 1),
      "APP_PORT=3000\n  APP_PORT=4000",
      "config.env"
    );

    expect(loaded.value).toEqual({ APP_PORT: "4000" });
    expect(loaded.locations).toEqual([{
      path: ["APP_PORT"],
      location: { sourceId: "dotenv", sourcePath: "config.env", line: 2, column: 3 }
    }]);
  });

  it("loads dotenv files and lets declared mappings control paths", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uce-dotenv-"));
    try {
      const filePath = join(dir, ".env.example");
      await writeFile(filePath, "APP_PORT=3000\nUNMAPPED=value\n", "utf8");

      const loaded = await loadDotenvFileSource({
        descriptor: descriptor("dotenv", "dotenv-file", 1),
        filePath
      });
      const mapped = createProcessEnvSource({
        descriptor: descriptor("env", "process-env", 10),
        env: loaded.value as NodeJS.ProcessEnv,
        mappings: [
          {
            externalName: "APP_PORT",
            sourceKind: "process-env",
            targetPath: ["server", "port"],
            parseAs: "number"
          }
        ]
      });
      const result = resolveConfig({ sources: [mapped] });

      expect(result.ok).toBe(true);
      expect(result.config).toEqual({ server: { port: 3000 } });
      expect(loaded.locations).toEqual(expect.arrayContaining([
        {
          path: ["APP_PORT"],
          location: {
            sourceId: "dotenv",
            sourcePath: await realpath(filePath),
            line: 1,
            column: 1
          }
        }
      ]));
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("returns bounded issues for oversized dotenv files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uce-dotenv-large-"));
    try {
      const filePath = join(dir, ".env");
      await writeFile(filePath, "APP_PORT=3000\n", "utf8");

      const loaded = await loadDotenvFileSource({
        descriptor: descriptor("dotenv", "dotenv-file", 1),
        filePath,
        maxFileBytes: 2
      });

      expect(loaded.issues).toContainEqual(
        expect.objectContaining({
          category: "resource-limit",
          code: "max_file_bytes_exceeded",
          sourceId: "dotenv"
        })
      );
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("maps process env only through declared mappings", () => {
    const loaded = createProcessEnvSource({
      descriptor: descriptor("env", "process-env", 10),
      env: {
        APP_PORT: "8080",
        SHOULD_NOT_APPEAR: "true"
      },
      mappings: [
        {
          externalName: "APP_PORT",
          sourceKind: "process-env",
          targetPath: ["server", "port"],
          parseAs: "number"
        }
      ]
    });
    const result = resolveConfig({ sources: [loaded] });

    expect(result.ok).toBe(true);
    expect(result.config).toEqual({ server: { port: 8080 } });
  });

  it("warns for unmapped env names only inside the declared prefix", () => {
    const loaded = createProcessEnvSource({
      descriptor: descriptor("env", "process-env", 10),
      env: { APP_PORT: "8080", APP_TYPO: "secret-value", PATH: "ignored" },
      mappings: [{
        externalName: "APP_PORT",
        sourceKind: "process-env",
        targetPath: ["server", "port"],
        parseAs: "number"
      }],
      unmappedBehavior: "warning",
      unmappedPrefix: "APP_"
    });
    const result = resolveConfig({ sources: [loaded] });

    expect(result.ok).toBe(true);
    expect(result.config).toEqual({ server: { port: 8080 } });
    expect(result.issues).toEqual([expect.objectContaining({
      code: "unmapped_env_entry",
      severity: "warning",
      details: { externalName: "APP_TYPO" }
    })]);
    expect(JSON.stringify(result)).not.toContain("secret-value");
  });

  it("requires an env prefix before strict unmapped checks", () => {
    const loaded = createProcessEnvSource({
      descriptor: descriptor("env", "process-env", 10),
      env: { APP_PORT: "8080" },
      mappings: [],
      unmappedBehavior: "error"
    });
    expect(loaded.issues).toContainEqual(expect.objectContaining({ code: "unmapped_env_prefix_required" }));
  });

  it("rejects invalid direct-library unmapped policies", () => {
    const env = createProcessEnvSource({
      descriptor: descriptor("env", "process-env", 10),
      env: {},
      mappings: [],
      unmappedPrefix: "APP_"
    });
    const argv = createArgvSource({
      descriptor: descriptor("argv", "argv", 20),
      argv: [],
      mappings: [],
      unmappedBehavior: "ignore" as "warning"
    });
    expect(env.issues).toContainEqual(expect.objectContaining({ code: "unmapped_env_behavior_required" }));
    expect(argv.issues).toContainEqual(expect.objectContaining({ code: "unmapped_argv_behavior_invalid" }));
  });

  it("rejects process env sources that exceed the entry limit before mapping", () => {
    const loaded = createProcessEnvSource({
      descriptor: descriptor("env", "process-env", 10),
      env: {
        APP_PORT: "8080",
        EXTRA: "ignored"
      },
      mappings: [
        {
          externalName: "APP_PORT",
          sourceKind: "process-env",
          targetPath: ["server", "port"],
          parseAs: "number"
        }
      ],
      maxEnvEntries: 1
    });

    expect(loaded.value).toEqual({});
    expect(loaded.issues).toEqual([
      expect.objectContaining({
        category: "resource-limit",
        code: "max_env_entries_exceeded",
        sourceId: "env",
        details: {
          envEntries: 2,
          maxEnvEntries: 1
        }
      })
    ]);
  });

  it("uses the default environment bound when a runtime entry limit is invalid", () => {
    const env = Object.fromEntries(
      Array.from({ length: 4097 }, (_, index) => [`KEY_${index}`, String(index)])
    );
    const loaded = createProcessEnvSource({
      descriptor: descriptor("env", "process-env", 10),
      env,
      mappings: [],
      maxEnvEntries: Number.NaN
    });

    expect(loaded.issues).toContainEqual(
      expect.objectContaining({
        category: "resource-limit",
        code: "max_env_entries_exceeded",
        details: expect.objectContaining({ maxEnvEntries: 4096 })
      })
    );
  });

  it("maps argv values from explicit flags and assignments", () => {
    const loaded = createArgvSource({
      descriptor: descriptor("argv", "argv", 20),
      argv: ["--port", "9000", "--mode=prod", "--ignored", "value"],
      mappings: [
        {
          externalName: "--port",
          sourceKind: "argv",
          targetPath: ["server", "port"],
          parseAs: "number"
        },
        {
          externalName: "--mode",
          sourceKind: "argv",
          targetPath: ["app", "mode"]
        }
      ]
    });
    const result = resolveConfig({ sources: [loaded] });

    expect(result.ok).toBe(true);
    expect(result.config).toEqual({
      server: { port: 9000 },
      app: { mode: "prod" }
    });
  });

  it("warns for unmapped argv entries without exposing their text", () => {
    const loaded = createArgvSource({
      descriptor: descriptor("argv", "argv", 20),
      argv: ["--port", "9000", "--unknown", "argv-secret-value", "positional-secret"],
      mappings: [{
        externalName: "--port",
        sourceKind: "argv",
        targetPath: ["server", "port"],
        parseAs: "number"
      }],
      unmappedBehavior: "warning"
    });
    const result = resolveConfig({ sources: [loaded] });

    expect(result.ok).toBe(true);
    expect(result.config).toEqual({ server: { port: 9000 } });
    expect(result.issues).toEqual([
      expect.objectContaining({ code: "unmapped_argv_entry", severity: "warning", details: { argumentIndex: 2 } }),
      expect.objectContaining({ code: "unmapped_argv_entry", severity: "warning", details: { argumentIndex: 4 } })
    ]);
    expect(JSON.stringify(result)).not.toContain("argv-secret-value");
    expect(JSON.stringify(result)).not.toContain("positional-secret");
  });

  it("rejects argv sources when unmapped behavior is error", () => {
    const loaded = createArgvSource({
      descriptor: descriptor("argv", "argv", 20),
      argv: ["--unknown=value"],
      mappings: [],
      unmappedBehavior: "error"
    });
    const result = resolveConfig({ sources: [loaded] });
    expect(result.ok).toBe(false);
    expect(result.config).toEqual({});
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: "unmapped_argv_entry",
      severity: "error"
    }));
  });

  it("scans large declared argv mappings without repeated full-array searches", () => {
    const count = 4096;
    const loaded = createArgvSource({
      descriptor: descriptor("argv", "argv", 20),
      argv: Array.from({ length: count }, (_, index) => `--key-${index}=${index}`),
      mappings: Array.from({ length: count }, (_, index) => ({
        externalName: `--key-${index}`,
        sourceKind: "argv" as const,
        targetPath: [`key${index}`],
        parseAs: "number" as const
      }))
    });

    expect(loaded.issues).toEqual([]);
    expect(loaded.value).toMatchObject({ key0: 0, key4095: 4095 });
  });

  it("rejects argv sources that exceed the entry limit before mapping", () => {
    const loaded = createArgvSource({
      descriptor: descriptor("argv", "argv", 20),
      argv: ["--port", "9000"],
      mappings: [
        {
          externalName: "--port",
          sourceKind: "argv",
          targetPath: ["server", "port"],
          parseAs: "number"
        }
      ],
      maxArgvEntries: 1
    });

    expect(loaded.value).toEqual({});
    expect(loaded.issues).toEqual([
      expect.objectContaining({
        category: "resource-limit",
        code: "max_argv_entries_exceeded",
        sourceId: "argv",
        details: {
          argvEntries: 2,
          maxArgvEntries: 1
        }
      })
    ]);
  });

  it("uses the default argument bound when a runtime entry limit is invalid", () => {
    const loaded = createArgvSource({
      descriptor: descriptor("argv", "argv", 20),
      argv: Array.from({ length: 4097 }, (_, index) => String(index)),
      mappings: [],
      maxArgvEntries: Number.POSITIVE_INFINITY
    });

    expect(loaded.issues).toContainEqual(
      expect.objectContaining({
        category: "resource-limit",
        code: "max_argv_entries_exceeded",
        details: expect.objectContaining({ maxArgvEntries: 4096 })
      })
    );
  });

  it("reports missing argv values instead of guessing booleans", () => {
    const loaded = createArgvSource({
      descriptor: descriptor("argv", "argv", 20),
      argv: ["--port", "--other"],
      mappings: [
        {
          externalName: "--port",
          sourceKind: "argv",
          targetPath: ["server", "port"],
          parseAs: "number"
        }
      ]
    });

    expect(loaded.issues).toContainEqual(
      expect.objectContaining({
        category: "mapping",
        code: "argv_missing_value"
      })
    );
  });

  it("reports short flags as missing argv values instead of treating them as values", () => {
    const loaded = createArgvSource({
      descriptor: descriptor("argv", "argv", 20),
      argv: ["--mode", "-v"],
      mappings: [
        {
          externalName: "--mode",
          sourceKind: "argv",
          targetPath: ["app", "mode"]
        }
      ]
    });

    expect(loaded.value).toEqual({});
    expect(loaded.issues).toContainEqual(
      expect.objectContaining({
        category: "mapping",
        code: "argv_missing_value",
        path: ["app", "mode"]
      })
    );
  });

  it("allows negative numeric argv values", () => {
    const loaded = createArgvSource({
      descriptor: descriptor("argv", "argv", 20),
      argv: ["--offset", "-1.5"],
      mappings: [
        {
          externalName: "--offset",
          sourceKind: "argv",
          targetPath: ["tuning", "offset"],
          parseAs: "number"
        }
      ]
    });
    const result = resolveConfig({ sources: [loaded] });

    expect(result.ok).toBe(true);
    expect(result.config).toEqual({
      tuning: {
        offset: -1.5
      }
    });
  });

  it("reports duplicate argv values instead of choosing an occurrence", () => {
    const loaded = createArgvSource({
      descriptor: descriptor("argv", "argv", 20),
      argv: ["--port", "9000", "--port=8080"],
      mappings: [
        {
          externalName: "--port",
          sourceKind: "argv",
          targetPath: ["server", "port"],
          parseAs: "number"
        }
      ]
    });

    expect(loaded.value).toEqual({});
    expect(loaded.issues).toContainEqual(
      expect.objectContaining({
        category: "mapping",
        code: "argv_duplicate_argument",
        sourceId: "argv",
        path: ["server", "port"]
      })
    );
  });
});
