import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCliArgs, runCli } from "../src/index.js";
import { withTempDir } from "./helpers/temp-directory.js";

describe("opt-in CLI inspection", () => {
  it("keeps legacy JSON unchanged and exposes bounded safe values only on request", async () => {
    await withTempDir(async (cwd) => {
      await writeFile(join(cwd, "uce.json"), JSON.stringify({ sources: [{ id: "file", kind: "object", priority: 0,
        value: { rows: [{ "a.b": "hello\n\u001b", password: "private input" }] } }] }));
      async function run(extra: string[]) {
        let stdout = "";
        const result = await runCli(["explain", "--config", "uce.json", ...extra], {
          cwd, env: {}, stdout: (text) => { stdout += text; }, stderr: () => {}
        });
        return { ...result, stdout };
      }
      const legacy = await run(["--json"]);
      expect(JSON.parse(legacy.stdout).schemaVersion).toBe("0.2");
      expect(legacy.stdout).not.toContain("hello");
      const inspected = await run(["--values", "--json"]);
      expect(inspected.exitCode).toBe(0);
      expect(JSON.parse(inspected.stdout).schemaVersion).toBe("inspection-1");
      expect(inspected.stdout).not.toContain("private input");
      const selected = await run(["--path", '["rows",0,"a.b"]']);
      expect(selected.exitCode).toBe(0);
      expect(selected.stdout).toContain('"hello\\n\\u001b"');
      expect(selected.stdout).not.toContain("\u001b");
      expect((await run(["--path", '["absent"]'])).exitCode).toBe(4);
    });
  });

  it("runs declared validators before exposing effective values", async () => {
    await withTempDir(async (cwd) => {
      await writeFile(join(cwd, "uce.json"), JSON.stringify({
        sources: [{ id: "file", kind: "object", priority: 0, value: { port: "wrong type" } }],
        validators: [{ id: "schema", kind: "json-schema-ajv", schema: { type: "object", properties: { port: { type: "number" } } } }]
      }));
      let stdout = "";
      const result = await runCli(["explain", "--config", "uce.json", "--values", "--json"], {
        cwd, env: {}, stdout: (text) => { stdout += text; }, stderr: () => {}
      });
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(stdout).entries).toEqual([]);
      expect(stdout).not.toContain("wrong type");
    });
  });

  it("rejects malformed typed paths and inspection flags on validate", () => {
    for (const path of ['[1.5]', '["a",-1]', '[null]', 'a.b']) {
      expect(() => parseCliArgs(["explain", "--config", "uce.json", "--path", path])).toThrow();
    }
    expect(() => parseCliArgs(["validate", "--config", "uce.json", "--values"])).toThrow();
    expect(() => parseCliArgs(["explain", "--config", "uce.json", "--path", JSON.stringify(["가".repeat(6000)])])).toThrow("16 KiB");
  });
});
