import { readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";
import { withTempDir } from "./helpers/temp-directory.js";

async function invoke(cwd: string, args: string[]) {
  let output = "";
  const result = await runCli(args, { cwd, env: {}, stdout: text => { output += text; }, stderr() {} });
  return { ...result, report: JSON.parse(output) };
}

describe("non-destructive initialization", () => {
  it("creates a usable minimal declaration once and never overwrites it", async () => {
    await withTempDir(async root => {
      expect(await invoke(root, ["init", "--json"])).toMatchObject({ exitCode: 0, report: { status: "created" } });
      const original = await readFile(join(root, "uce.json"), "utf8");
      expect((await invoke(root, ["validate", "--config", "uce.json", "--json"])).exitCode).toBe(0);
      expect(await invoke(root, ["init", "--directory=.", "--json"])).toMatchObject({ exitCode: 4, report: { code: "init_exists" } });
      expect(await readFile(join(root, "uce.json"), "utf8")).toBe(original);
    });
  });
  it("refuses existing symlinks and invalid options without disclosing paths", async () => {
    await withTempDir(async root => {
      await writeFile(join(root, "original.json"), "UCE_INIT_PRIVATE");
      await symlink(join(root, "original.json"), join(root, "uce.json"), "file");
      expect((await invoke(root, ["init", "--json"])).report.code).toBe("init_exists");
      expect(await readFile(join(root, "original.json"), "utf8")).toBe("UCE_INIT_PRIVATE");
      expect((await invoke(root, ["init", "--directory", "--json"])).report.code).toBe("cli_usage_error");
      const failed = await invoke(root, ["init", "--directory", "UCE_INIT_PRIVATE", "--json"]);
      expect(failed.exitCode).toBe(2); expect(JSON.stringify(failed)).not.toContain("UCE_INIT_PRIVATE");
    });
  });
});
