import { execFileSync } from "node:child_process";
import {
  cpSync,
  writeFileSync
} from "node:fs";
import { join } from "node:path";
import { checkPackedCliFailures } from "./check-packed-cli-failures.mjs";

import {
  WORKSPACE_PACKAGE_NAMES,
  packageTarballPath,
  runPnpm,
  runNpm,
  runInstalledCli,
  withWorkspaceSmoke
} from "./lib/package-tools.mjs";

const root = process.cwd();
await withWorkspaceSmoke(root, async ({ packDir, consumerDir: consumerRoot }) => {
  runPnpm(["-r", "build"]);
  for (const packageName of WORKSPACE_PACKAGE_NAMES) {
    runPnpm(["--filter", packageName, "pack", "--pack-destination", packDir]);
  }

  runModuleScenario("core", ["@0disoft/universal-config-engine-core"]);
  runStrictTypeScriptCoreScenario();
  runModuleScenario("node", [
    "@0disoft/universal-config-engine-core",
    "@0disoft/universal-config-engine-node"
  ]);
  runModuleScenario("ajv", [
    "@0disoft/universal-config-engine-core",
    "@0disoft/universal-config-engine-validator-ajv"
  ], { ajv: "^8.20.0" });
  runModuleScenario("zod", [
    "@0disoft/universal-config-engine-core",
    "@0disoft/universal-config-engine-validator-zod"
  ], { zod: "^4.4.3" });
  runCliScenario();

  function runModuleScenario(name, workspacePackages, registryDependencies = {}) {
    const directory = prepareScenario(name, workspacePackages, registryDependencies);
    runNpm(["install", "--ignore-scripts"], directory);
    execFileSync(process.execPath, [join(directory, "index.mjs")], {
      cwd: directory,
      stdio: "inherit"
    });
  }

  function runStrictTypeScriptCoreScenario() {
    const directory = join(consumerRoot, "core");
    cpSync(
      join(root, "fixtures", "consumer", "validator-1.0-types.ts"),
      join(directory, "validator-1.0-types.ts")
    );
    const typescriptCli = join(root, "node_modules", "typescript", "bin", "tsc");
    execFileSync(process.execPath, [typescriptCli, "-p", join(directory, "tsconfig.json")], {
      cwd: directory,
      stdio: "inherit"
    });
    execFileSync(process.execPath, [join(directory, "dist", "index.js")], {
      cwd: directory,
      stdio: "inherit"
    });
  }

  function runCliScenario() {
    const directory = prepareScenario("cli", [
      "@0disoft/universal-config-engine-core",
      "@0disoft/universal-config-engine-node",
      "@0disoft/universal-config-engine-validator-ajv",
      "@0disoft/universal-config-engine-cli"
    ], { ajv: "^8.20.0" });
    runNpm(["install", "--ignore-scripts"], directory);
    checkPackedCliFailures(directory);
    cpSync(join(root, "fixtures", "consumer", "file-formats.mjs"), join(directory, "file-formats.mjs"));
    execFileSync(process.execPath, [join(directory, "file-formats.mjs")], { cwd: directory, stdio: "inherit" });
    const output = runInstalledCli(directory);
    const report = JSON.parse(output);
    if (report.command !== "validate" || report.status !== "ok" || report.schemaVersion !== "0.2") {
      throw new Error("CLI consumer failed.");
    }
  }

  function prepareScenario(name, workspacePackages, registryDependencies) {
    const directory = join(consumerRoot, name);
    cpSync(join(root, "fixtures", "consumer-matrix", name), directory, { recursive: true });
    const packedDependencies = Object.fromEntries(
      workspacePackages.map((packageName) => [packageName, `file:${packageTarballPath(root, packDir, packageName)}`])
    );
    writeFileSync(
      join(directory, "package.json"),
      `${JSON.stringify({
        private: true,
        type: "module",
        dependencies: { ...packedDependencies, ...registryDependencies },
        overrides: packedDependencies
      }, null, 2)}\n`,
      "utf8"
    );
    return directory;
  }
});
