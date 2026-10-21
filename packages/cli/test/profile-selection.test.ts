import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";
import { withTempDir } from "./helpers/temp-directory.js";

async function invoke(cwd: string, args: string[]) {
  let output = "";
  const result = await runCli(args, { cwd, env: { NODE_ENV: "production" }, stdout: text => { output += text; }, stderr() {} });
  return { ...result, report: JSON.parse(output) };
}

describe("CLI profile and workspace selectors", () => {
  it("selects only explicit profiles across inherited declarations", async () => {
    await withTempDir(async root => {
      await mkdir(join(root, "app"));
      await writeFile(join(root, "base.json"), JSON.stringify({ sources: [{ id: "base", kind: "object", priority: 0, value: { port: 80 } }],
        profiles: { production: { sources: [{ id: "prod", kind: "object", priority: 10, value: { port: 443 } }] } } }));
      await writeFile(join(root, "app/uce.json"), JSON.stringify({ extends: ["../base.json"], sources: [] }));
      const args = ["explain", "--config", "app/uce.json", "--workspace", ".", "--values", "--json"];
      const base = await invoke(root, args);
      expect(base.exitCode).toBe(0); expect(base.report.entries).toContainEqual(expect.objectContaining({ path: ["port"], value: 80 }));
      const selected = await invoke(root, [...args, "--profile=production"]);
      expect(selected.exitCode).toBe(0); expect(selected.report.entries).toContainEqual(expect.objectContaining({ path: ["port"], value: 443 }));
      expect((await invoke(root, [...args, "--profile", "missing"])).exitCode).toBe(4);
      const discovered = await invoke(join(root, "app"), ["explain", "--discover", "..", "--profile", "production", "--values", "--json"]);
      expect(discovered.exitCode).toBe(0); expect(discovered.report.entries).toContainEqual(expect.objectContaining({ path: ["port"], value: 443 }));
      const diff = await invoke(root, ["diff", "--config", "app/uce.json", "--against", "app/uce.json", "--workspace", ".", "--profile", "production", "--json"]);
      expect(diff.exitCode).toBe(0); expect(diff.report.status).toBe("ok");
    });
  });

  it.each([
    ["--profile", "production", "--profile=production"], ["--profile", "--json"],
    ["--profile=__proto__"], ["--workspace", ".", "--workspace=.."],
    ["--discover", ".", "--workspace", "."]
  ])("rejects ambiguous or invalid selectors before opening files", async (...extra) => {
    await withTempDir(async root => {
      const checked = await invoke(root, ["validate", "--config", "absent.json", "--json", ...extra]);
      expect(checked.exitCode).toBe(4); expect(checked.report.issues[0].code).toBe("cli_usage_error");
    });
  });
});
