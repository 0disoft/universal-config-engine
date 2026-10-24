import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";

async function invoke(args: string[]) {
  let stdout = "", stderr = "";
  const result = await runCli(args, { cwd: "nonexistent-information-command-directory", env: {},
    stdout: text => { stdout += text; }, stderr: text => { stderr += text; } });
  return { ...result, stdout, stderr };
}

describe("standalone CLI information", () => {
  it.each([["--help"], ["-h"], ["help"], ["validate", "--help"], ["help", "init"], ["doctor", "-h"]])(
    "shows help without loading a declaration (%j)", async (...args) => {
      const result = await invoke(args);
      expect(result.exitCode).toBe(0); expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Usage: uce"); expect(result.stdout).toContain("APP_PORT");
    });
  it.each(["--version", "-v"])("reads %s from installed package metadata", async flag => {
    const metadata = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    expect(await invoke([flag])).toEqual({ exitCode: 0, stdout: `${metadata.version}\n`, stderr: "" });
  });
  it("does not reinterpret source arguments as global information flags", async () => {
    expect((await invoke(["validate", "--", "--help"])).exitCode).toBe(4);
  });
});
