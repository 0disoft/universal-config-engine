import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadPipelineDeclarationContext, runCli } from "../src/index.js";
import { withTempDir } from "./helpers/temp-directory.js";

async function run(cwd: string, args: readonly string[]) {
  let stdout = "";
  let stderr = "";
  const result = await runCli(args, { cwd, env: {}, stdout: text => { stdout += text; }, stderr: text => { stderr += text; } });
  expect(stderr).toBe("");
  return { ...result, report: JSON.parse(stdout) };
}
const declaration = { sources: [{ id: "defaults", kind: "object", priority: 0, value: { port: 80 } }] };

describe("explicit CLI discovery", () => {
  it("finds a parent declaration within the chosen workspace", async () => {
    await withTempDir(async root => {
      await mkdir(join(root, "service"));
      await writeFile(join(root, "uce.json"), JSON.stringify(declaration));
      const inspected = await run(join(root, "service"), ["explain", "--discover", "..", "--values", "--json"]);
      expect(inspected.exitCode).toBe(0);
      expect(inspected.report.schemaVersion).toBe("inspection-1");
      expect(inspected.report.entries).toContainEqual(expect.objectContaining({ path: ["port"], value: 80 }));
    });
  });

  it("starts at an explicitly selected child workspace from outside it", async () => {
    await withTempDir(async root => {
      await mkdir(join(root, "service"));
      await writeFile(join(root, "service/.uce.json"), JSON.stringify(declaration));
      const checked = await run(root, ["validate", "--discover=service", "--json"]);
      expect(checked.exitCode).toBe(0);
      expect(checked.report.schemaVersion).toBe("0.2");
    });
  });

  it.each([
    ["explain", "--discover", ".", "--config", "uce.json", "--json"],
    ["explain", "--discover", "--json"],
    ["explain", "--discover", ".", "--discover=.", "--json"],
    ["diff", "--discover", ".", "--against", "uce.json", "--json"]
  ].map(args => ({ args })))("rejects invalid discovery usage before file selection", async ({ args }) => {
    await withTempDir(async root => {
      const checked = await run(root, args);
      expect(checked.exitCode).toBe(4);
      expect(checked.report.issues[0].code).toBe("cli_usage_error");
    });
  });

  it("retains source failure envelopes for an unsuccessful discovery", async () => {
    await withTempDir(async root => {
      const checked = await run(root, ["validate", "--discover", ".", "--json"]);
      expect(checked.exitCode).toBe(2);
      expect(checked.report.issues[0].code).toBe("config_not_found");
      const inspected = await run(root, ["explain", "--discover", ".", "--values", "--json"]);
      expect(inspected.exitCode).toBe(2);
      expect(inspected.report.schemaVersion).toBe("inspection-1");
      expect(inspected.report.entries).toEqual([]);
    });
  });

  it("keeps explicit --config required when discovery is not requested", async () => {
    await withTempDir(async root => {
      await writeFile(join(root, "uce.json"), JSON.stringify(declaration));
      expect((await run(root, ["validate", "--json"])).exitCode).toBe(4);
    });
  });

  it("does not fall back from a malformed nearest candidate", async () => {
    await withTempDir(async root => {
      await mkdir(join(root, "service"));
      await writeFile(join(root, "uce.json"), JSON.stringify(declaration));
      await writeFile(join(root, "service/.uce.json"), "not JSON");
      expect((await run(join(root, "service"), ["validate", "--discover", "..", "--json"])).exitCode).toBe(2);
    });
  });

  it("rechecks the workspace on the opened declaration after selection", async () => {
    await withTempDir(async root => {
      await mkdir(join(root, "service"));
      await writeFile(join(root, "outside.json"), JSON.stringify(declaration));
      await symlink(join(root, "outside.json"), join(root, "service/uce.json"), "file");
      await expect(loadPipelineDeclarationContext("uce.json", join(root, "service"), { allowedRootPath: join(root, "service") }))
        .rejects.toMatchObject({ issues: [expect.objectContaining({ code: "file_path_outside_allowed_root" })] });
    });
  });
});
