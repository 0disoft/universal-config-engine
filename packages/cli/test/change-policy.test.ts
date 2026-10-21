import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCliArgs, runCli } from "../src/index.js";
import { parseInspectionArgs } from "../src/args.js";
import { withTempDir } from "./helpers/temp-directory.js";

describe("CLI change policy", () => {
  it("uses exit 3 for violations and exit 0 for an allowed change", async () => {
    await withTempDir(async (cwd) => {
      for (const [name, port] of [["before", 80], ["after", 443]]) await writeFile(join(cwd, `${name}.json`), JSON.stringify({
        sources: [{ id: "file", kind: "object", priority: 0, value: { port } }]
      }));
      for (const mode of ["forbid-changes", "require-path"]) {
        await writeFile(join(cwd, "policy.json"), JSON.stringify({ version: "change-policy-1", rules: [{ id: "port", path: ["port"], mode }] }));
        let stdout = "";
        const execution = await runCli(["diff", "--config", "before.json", "--against", "after.json", "--policy", "policy.json", "--json"], {
          cwd, env: {}, stdout: (text) => { stdout += text; }, stderr: () => {}
        });
        expect(execution.exitCode).toBe(mode === "forbid-changes" ? 3 : 0);
        expect(JSON.parse(stdout).schemaVersion).toBe("change-check-1");
        expect(JSON.parse(stdout).policy.status).toBe(mode === "forbid-changes" ? "failed" : "passed");
      }
    });
  });

  it("bounds policy files and suppresses parser errors, rejects narrowed policy comparisons", async () => {
    await withTempDir(async (cwd) => {
      for (const raw of ['{"private":"invalid private input", bad', " ".repeat(1024 * 1024 + 1)]) {
        await writeFile(join(cwd, "policy.json"), raw);
        let stdout = "";
        const execution = await runCli(["diff", "--config", "missing.json", "--against", "also-missing.json", "--policy", "policy.json", "--json"], {
          cwd, env: {}, stdout: (text) => { stdout += text; }, stderr: () => {}
        });
        expect(execution.exitCode).toBe(raw.startsWith("{") ? 2 : 3);
        expect(JSON.parse(stdout).status).toBe("error");
        expect(stdout).not.toContain("invalid private input");
      }
    });
    expect(() => parseInspectionArgs(["diff", "--config", "a", "--against", "b", "--policy", "p", "--path", "[]"])).toThrow();
    expect(() => parseCliArgs(["validate", "--config", "a", "--policy", "p"])).toThrow();
  });
});
