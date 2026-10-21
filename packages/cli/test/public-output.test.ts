import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";
import { withTempDir } from "./helpers/temp-directory.js";

async function invoke(cwd: string, args: string[]) {
  let output = "";
  const result = await runCli(args, { cwd, env: {}, stdout: text => { output += text; }, stderr() {} });
  return { ...result, output, report: JSON.parse(output) };
}

describe("opt-in public CLI projection", () => {
  it.each(["explain", "validate", "doctor"])("projects %s without private metadata", async command => {
    await withTempDir(async root => {
      await writeFile(join(root, "uce.json"), JSON.stringify({ sources: [{ id: "UCE_PUBLIC_PRIVATE_ID", kind: "object", priority: 12345,
        displayName: "UCE_PUBLIC_PRIVATE_NAME", value: { UCE_PUBLIC_PRIVATE_PATH: "UCE_PUBLIC_PRIVATE_VALUE" } }] }));
      const shared = await invoke(root, [command, "--config", "uce.json", "--public"]);
      expect(shared.exitCode).toBe(0); expect(shared.report.schemaVersion).toBe("public-diagnostic-1");
      expect(shared.output).not.toContain("UCE_PUBLIC_PRIVATE"); expect(shared.output).not.toContain(root);
      expect(shared.output).not.toContain("12345"); expect(shared.report.sources[0].id).toBe("source-1");
    });
  });
  it.each([
    ["explain", "--public", "--config", "absent", "--values"],
    ["validate", "--public", "--UCE_PUBLIC_PRIVATE_UNKNOWN"],
    ["diff", "--public", "--config", "absent"],
    ["init", "--public"], ["doctor", "--public", "--public"]
  ])("keeps invalid usage inside the public envelope", async (...args) => {
    await withTempDir(async root => {
      const shared = await invoke(root, args);
      expect(shared.exitCode).toBe(4); expect(shared.report.schemaVersion).toBe("public-diagnostic-1");
      expect(shared.report.status).toBe("error"); expect(shared.output).not.toContain("UCE_PUBLIC_PRIVATE");
    });
  });
});
