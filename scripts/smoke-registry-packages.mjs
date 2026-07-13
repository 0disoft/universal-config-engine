import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const version = process.env.RELEASE_VERSION;
if (version === undefined || !/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error("RELEASE_VERSION must be an exact semantic version such as 0.5.0.");
}

const packageNames = [
  "@0disoft/universal-config-engine-core",
  "@0disoft/universal-config-engine-node",
  "@0disoft/universal-config-engine-cli",
  "@0disoft/universal-config-engine-validator-ajv",
  "@0disoft/universal-config-engine-validator-zod"
];
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

  runNpm(["install", "--ignore-scripts", "--registry=https://registry.npmjs.org/", ...packageNames.map((name) => `${name}@${version}`)]);
  execFileSync(process.execPath, [join(consumerDir, "consumer-smoke.mjs")], { cwd: consumerDir, stdio: "inherit" });
  const bin = join(consumerDir, "node_modules", ".bin", process.platform === "win32" ? "uce.cmd" : "uce");
  const output = process.platform === "win32"
    ? execFileSync("cmd.exe", ["/d", "/c", ".\\node_modules\\.bin\\uce.cmd validate --config uce.json --json"], { cwd: consumerDir, encoding: "utf8" })
    : execFileSync(bin, ["validate", "--config", "uce.json", "--json"], { cwd: consumerDir, encoding: "utf8" });
  const report = JSON.parse(output);
  if (report.command !== "validate" || report.status !== "ok") throw new Error("installed CLI binary smoke failed");
} finally {
  rmSync(consumerDir, { force: true, recursive: true });
}

function runNpm(args) {
  const env = { ...process.env };
  delete env.npm_config_manage_package_manager_versions;
  delete env.NPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS;
  const npmCliPath = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (existsSync(npmCliPath)) {
    execFileSync(process.execPath, [npmCliPath, ...args], { cwd: consumerDir, env, stdio: "inherit" });
    return;
  }
  execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", args, {
    cwd: consumerDir,
    env,
    stdio: "inherit",
    shell: process.platform === "win32"
  });
}
