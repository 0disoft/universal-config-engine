import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseReleaseVersion } from "./release-version.mjs";

import { WORKSPACE_PACKAGE_NAMES, runNpm, runInstalledCli } from "./lib/package-tools.mjs";

const version = process.env.RELEASE_VERSION;
if (version === undefined) {
  throw new Error("RELEASE_VERSION must be set to an exact release version.");
}
parseReleaseVersion(version);

const consumerDir = mkdtempSync(join(tmpdir(), "uce-registry-consumer-"));

try {
  writeFileSync(join(consumerDir, "package.json"), `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`, "utf8");
  writeFileSync(
    join(consumerDir, "uce.json"),
    `${JSON.stringify({ sources: [{ id: "defaults", kind: "object", priority: 0, value: { app: { port: 3000 } } }] }, null, 2)}\n`,
    "utf8"
  );
  writeFileSync(
    join(consumerDir, "consumer-smoke.mjs"),
    [
      'import { resolveConfig } from "@0disoft/universal-config-engine-core";',
      'import { createProcessEnvSource } from "@0disoft/universal-config-engine-node";',
      'import { parseCliArgs } from "@0disoft/universal-config-engine-cli";',
      'import { createAjvValidator } from "@0disoft/universal-config-engine-validator-ajv";',
      'import { createZodValidator } from "@0disoft/universal-config-engine-validator-zod";',
      'const source = createProcessEnvSource({ descriptor: { id: "env", kind: "process-env", priority: 1, displayName: "env" }, env: { APP_PORT: "3000" }, mappings: [{ externalName: "APP_PORT", sourceKind: "process-env", targetPath: ["app", "port"], parseAs: "number" }] });',
      'const result = resolveConfig({ sources: [source] });',
      'if (!result.ok || result.config.app.port !== 3000) throw new Error("installed core/node smoke failed");',
      'if (parseCliArgs(["validate", "--config", "uce.json"]).command !== "validate") throw new Error("installed CLI export smoke failed");',
      'if (typeof createAjvValidator !== "function" || typeof createZodValidator !== "function") throw new Error("installed validator smoke failed");'
    ].join("\n"),
    "utf8"
  );

  runNpm(["install", "--ignore-scripts", "--registry=https://registry.npmjs.org/", ...WORKSPACE_PACKAGE_NAMES.map((name) => `${name}@${version}`)], consumerDir);
  execFileSync(process.execPath, [join(consumerDir, "consumer-smoke.mjs")], { cwd: consumerDir, stdio: "inherit" });
  const output = runInstalledCli(consumerDir);
  const report = JSON.parse(output);
  if (report.command !== "validate" || report.status !== "ok") throw new Error("installed CLI binary smoke failed");
} finally {
  rmSync(consumerDir, { force: true, recursive: true });
}
