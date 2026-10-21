import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";
import { withTempDir } from "./helpers/temp-directory.js";

async function invoke(directory: string, args: readonly string[]) {
  let stdout = "";
  let stderr = "";
  const result = await runCli(args, { cwd: directory, env: {}, stdout: text => { stdout += text; }, stderr: text => { stderr += text; } });
  expect(stderr).toBe("");
  return { result, output: stdout, report: JSON.parse(stdout) };
}

describe("declared first-party file adapters", () => {
  it.each([
    ["jsonc", '{/* settings */ "port":80,"password":"UCE_FORMAT_PRIVATE_SENTINEL",}'],
    ["yaml", 'port: 80\npassword: UCE_FORMAT_PRIVATE_SENTINEL\n'],
    ["toml", 'port = 80\npassword = "UCE_FORMAT_PRIVATE_SENTINEL"\n'],
    ["json5", "{port:80,password:'UCE_FORMAT_PRIVATE_SENTINEL',}"]
  ] as const)("supports %s values without changing legacy output", async (format, text) => {
    await withTempDir(async dir => {
      await writeFile(join(dir, "settings"), text);
      await writeFile(join(dir, "uce.json"), JSON.stringify({ sources: [
        { id: "file", kind: "adapter", format, path: "settings", priority: 1,
          ...(format === "jsonc" ? { allowTrailingComma: true } : {}) }
      ] }));
      const inspected = await invoke(dir, ["explain", "--config", "uce.json", "--values", "--json"]);
      expect(inspected.result.exitCode).toBe(0);
      expect(inspected.report.entries).toContainEqual(expect.objectContaining({ path: ["port"], value: 80 }));
      expect(inspected.output).not.toContain("UCE_FORMAT_PRIVATE_SENTINEL");
      const legacy = await invoke(dir, ["validate", "--config", "uce.json", "--json"]);
      expect(legacy.result.exitCode).toBe(0);
      expect(legacy.report.schemaVersion).toBe("0.2");
      expect(legacy.report.sources[0].kind).toBe("adapter");
    });
  });

  it.each([
    { format: "unsupported", code: "pipeline_file_format_invalid" },
    { format: "yaml", allowTrailingComma: true, code: "pipeline_file_trailing_comma_invalid" },
    { format: "jsonc", allowTrailingComma: "true", code: "pipeline_file_trailing_comma_invalid" }
  ])("rejects an invalid adapter declaration before opening its file", async ({ code, ...fields }) => {
    await withTempDir(async dir => {
      await writeFile(join(dir, "uce.json"), JSON.stringify({ sources: [
        { id: "file", kind: "adapter", priority: 1, path: "absent", ...fields }
      ] }));
      const checked = await invoke(dir, ["validate", "--config", "uce.json", "--json"]);
      expect(checked.result.exitCode).toBe(2);
      expect(checked.report.issues).toContainEqual(expect.objectContaining({ code }));
      expect(checked.report.issues.some((issue: { code: string }) => issue.code === "config_file_read_failed")).toBe(false);
    });
  });

  it("keeps adapters within the declaration directory", async () => {
    await withTempDir(async dir => {
      await writeFile(join(dir, "uce.json"), JSON.stringify({ sources: [
        { id: "file", kind: "adapter", format: "yaml", priority: 1, path: "../outside.yaml" }
      ] }));
      const checked = await invoke(dir, ["validate", "--config", "uce.json", "--json"]);
      expect(checked.result.exitCode).toBe(2);
      expect(checked.report.issues[0].category).toBe("source-load");
    });
  });

  it("compares declarations that use different dialects", async () => {
    await withTempDir(async dir => {
      await writeFile(join(dir, "before.yaml"), "port: 80\n");
      await writeFile(join(dir, "after.toml"), "port = 443\n");
      for (const [name, format] of [["before", "yaml"], ["after", "toml"]] as const) {
        await writeFile(join(dir, `${name}.json`), JSON.stringify({ sources: [
          { id: "file", kind: "adapter", format, priority: 1, path: `${name}.${format}` }
        ] }));
      }
      const compared = await invoke(dir, ["diff", "--config", "before.json", "--against", "after.json", "--json"]);
      expect(compared.result.exitCode).toBe(0);
      expect(compared.report.changes).toContainEqual(expect.objectContaining({ path: ["port"], kinds: expect.arrayContaining(["value-changed"]) }));
    });
  });
});
