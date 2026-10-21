import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCliArgs, runCli } from "../src/index.js";
import { withTempDir } from "./helpers/temp-directory.js";

describe("CLI diff", () => {
  it("compares two declarations and never prints secret values in JSON or human output", async () => {
    await withTempDir(async (cwd) => {
      for (const [name, port, password] of [["before", 80, "before private input"], ["after", 443, "after private input"]]) {
        await writeFile(join(cwd, `${name}.json`), JSON.stringify({ sources: [{ id: "file", kind: "object", priority: 0, value: { port, password } }] }));
      }
      for (const extra of [["--json"], ["--detect-secret-changes"]]) {
        let stdout = "";
        const execution = await runCli(["diff", "--config", "before.json", "--against", "after.json", ...extra], {
          cwd, env: {}, stdout: (text) => { stdout += text; }, stderr: () => {}
        });
        expect(execution.exitCode).toBe(0);
        expect(stdout).not.toContain("before private input");
        expect(stdout).not.toContain("after private input");
        expect(stdout).toContain("value-changed");
        if (extra[0] === "--json") {
          const report = JSON.parse(stdout);
          expect(report.schemaVersion).toBe("diff-1");
          expect(report.uncomparedSecretPaths).toEqual([["password"]]);
        }
      }
    });
  });

  it("preserves source failures and refuses incomplete comparison", async () => {
    await withTempDir(async (cwd) => {
      let stdout = "";
      const execution = await runCli(["diff", "--config", "absent.json", "--against", "also-absent.json", "--json"], {
        cwd, env: {}, stdout: (text) => { stdout += text; }, stderr: () => {}
      });
      expect(execution.exitCode).toBe(2);
      expect(JSON.parse(stdout)).toMatchObject({ status: "error", changes: [] });
    });
  });

  it("rejects incomplete diff arguments and comparison flags on legacy commands", () => {
    expect(() => parseCliArgs(["diff", "--config", "before.json"])).toThrow();
    expect(() => parseCliArgs(["explain", "--config", "before.json", "--against", "after.json"])).toThrow();
    expect(() => parseCliArgs(["validate", "--config", "before.json", "--detect-secret-changes"])).toThrow();
  });
});
