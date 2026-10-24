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

describe("actionable configuration doctor", () => {
  it("shows sanitized human paths and escapes terminal control characters", async () => {
    await withTempDir(async root => {
      await writeFile(join(root, "uce.json"), JSON.stringify({ sources: [{ id: "base", kind: "object", priority: 0,
        value: { password: "UCE_DOCTOR_PRIVATE" } }], validators: [{ id: "schema\u001b[2J", kind: "json-schema-ajv", includeConstraints: true,
        schema: { type: "object", properties: { password: { type: "integer" } } } }] }));
      let output = "";
      const result = await runCli(["doctor", "--config", "uce.json"], {
        cwd: root, env: {}, stdout: text => { output += text; }, stderr() {}
      });
      expect(result.exitCode).toBe(1); expect(output).toContain('["password"]');
      expect(output).toContain('validator "schema\\u001b[2J"');
      expect(output).not.toContain("\u001b"); expect(output).not.toContain("UCE_DOCTOR_PRIVATE");
      expect(output).toContain("Diagnostic message redacted");
      expect(output).not.toContain("constraint");
    });
  });
  it.each([["--output", "json"], ["--output=json"]])("honors JSON output aliases for success and usage failures", async (...flags) => {
    await withTempDir(async root => {
      await writeFile(join(root, "uce.json"), JSON.stringify({ sources: [] }));
      const healthy = await invoke(root, ["doctor", "--config", "uce.json", ...flags]);
      expect(healthy.exitCode).toBe(0); expect(healthy.report.schemaVersion).toBe("doctor-1");
      const invalid = await invoke(root, ["doctor", "--config", "uce.json", ...flags, "--values"]);
      expect(invalid.exitCode).toBe(4); expect(invalid.report.fixes[0].code).toBe("check_usage");
    });
  });

  it("uses the shared parser's last output choice", async () => {
    await withTempDir(async root => {
      await writeFile(join(root, "uce.json"), JSON.stringify({ sources: [] }));
      for (const flags of [["--json", "--output", "human"], ["--output=json", "--output=human"]]) {
        let output = "";
        const result = await runCli(["doctor", "--config", "uce.json", ...flags], {
          cwd: root, env: {}, stdout: text => { output += text; }, stderr() {}
        });
        expect(result.exitCode).toBe(0);
        expect(output).toBe("Configuration doctor: ok\nNo configuration errors found.\n");
      }
    });
  });

  it("uses the shared pipeline and omits secret values", async () => {
    await withTempDir(async root => {
      await writeFile(join(root, "uce.json"), JSON.stringify({ sources: [{ id: "base", kind: "object", priority: 0,
        value: { password: "UCE_DOCTOR_PRIVATE" } }] }));
      const healthy = await invoke(root, ["doctor", "--config", "uce.json", "--json"]);
      expect(healthy.exitCode).toBe(0); expect(healthy.report.schemaVersion).toBe("doctor-1");
      expect(healthy.report.fixes).toEqual([]); expect(healthy.output).not.toContain("UCE_DOCTOR_PRIVATE");
      const profile = await invoke(root, ["doctor", "--discover", ".", "--profile", "missing", "--json"]);
      expect(profile.exitCode).toBe(4); expect(profile.report.fixes[0].code).toBe("select_declared_profile");
      const usage = await invoke(root, ["doctor", "--config", "uce.json", "--values", "--json"]);
      expect(usage.exitCode).toBe(4); expect(usage.report.fixes[0].code).toBe("check_usage");
      await writeFile(join(root, "uce.json"), "UCE_DOCTOR_PRIVATE");
      const broken = await invoke(root, ["doctor", "--config", "uce.json", "--json"]);
      expect(broken.exitCode).toBe(2); expect(broken.output).not.toContain("UCE_DOCTOR_PRIVATE");
    });
  });
  it("suggests initialization for missing discovery without running init", async () => {
    await withTempDir(async root => {
      const missing = await invoke(root, ["doctor", "--discover", ".", "--json"]);
      expect(missing.exitCode).toBe(2); expect(missing.report.fixes[0].code).toBe("create_declaration");
    });
  });
});
