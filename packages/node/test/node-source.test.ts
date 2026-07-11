import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "@0disoft/universal-config-engine-core";
import {
  createArgvSource,
  createProcessEnvSource,
  loadDotenvFileSource,
  loadJsonFileSource,
  parseSimpleDotenv
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
          message: "Failed to read or parse JSON source. Exception details were omitted from diagnostics."
        }
      ]);
      expect(JSON.stringify(loaded)).not.toContain("json-parser-secret-value");
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
