import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";
import { parseInspectionArgs } from "../src/args.js";
import { withTempDir } from "./helpers/temp-directory.js";

describe("selected CLI comparison dimensions", () => {
  it.each(["values", "sources", "locations"])("compares %s independently", async selected => {
    await withTempDir(async cwd => {
      for (const name of ["before", "after"]) {
        await writeFile(join(cwd, `${name}-values.json`), '{"port":80}');
        await writeFile(join(cwd, `${name}.json`), JSON.stringify({ sources: [
          { id: "file", kind: "json-file", priority: 0, path: `${name}-values.json` }
        ] }));
      }
      let stdout = "";
      const args = ["diff", "--config", "before.json", "--against", "after.json", "--json"];
      const runtime = { cwd, env: {}, stdout: (text: string) => { stdout += text; }, stderr() {} };
      expect((await runCli([...args, "--compare", selected], runtime)).exitCode).toBe(0);
      expect(JSON.parse(stdout).changes.length).toBe(selected === "locations" ? 1 : 0);
      expect(JSON.parse(stdout).comparison[selected]).toBe(true);
      stdout = "";
      await writeFile(join(cwd, "policy.json"), JSON.stringify({ version: "change-policy-1", comparison: { locations: false },
        rules: [{ id: "stable", path: [], mode: "forbid-changes" }] }));
      expect((await runCli([...args, "--policy", "policy.json"], runtime)).exitCode).toBe(0);
      expect(JSON.parse(stdout).policy.status).toBe("passed");
    });
  });
  it.each(["", "value", "values,values", "locations,unknown"])("rejects invalid selections (%s)", selection => {
    expect(() => parseInspectionArgs(["diff", "--config", "a", "--against", "b", `--compare=${selection}`])).toThrow();
  });
  it("prevents narrowing policy comparisons through caller flags", () => {
    expect(() => parseInspectionArgs(["diff", "--config", "a", "--against", "b", "--policy", "p", "--compare", "values"])).toThrow();
    expect(() => parseInspectionArgs(["validate", "--config", "a", "--compare", "values"])).toThrow();
    expect(parseInspectionArgs(["validate", "--config", "a", "--", "--compare", "values"]).sourceArgv).toEqual(["--compare", "values"]);
  });
});
