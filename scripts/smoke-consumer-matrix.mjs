import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const root = process.cwd();
const pnpmExecPath = process.env.npm_execpath;
const packDir = join(root, ".tmp", "consumer-matrix-pack");
const consumerRoot = mkdtempSync(join(tmpdir(), "uce-consumer-matrix-"));
const packageNames = [
  "@0disoft/universal-config-engine-core",
  "@0disoft/universal-config-engine-node",
  "@0disoft/universal-config-engine-validator-ajv",
  "@0disoft/universal-config-engine-validator-zod",
  "@0disoft/universal-config-engine-cli"
];

try {
  runPnpm(["-r", "build"]);
  mkdirSync(packDir, { recursive: true });
  for (const packageName of packageNames) {
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
} finally {
  for (const packageName of packageNames) {
    const directory = packageDirectory(packageName);
    rmSync(join(root, "packages", directory, "dist"), { force: true, recursive: true });
  }
  rmSync(packDir, { force: true, recursive: true });
  rmSync(consumerRoot, { force: true, recursive: true });
}

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
  const output = process.platform === "win32"
    ? execFileSync(
        "cmd.exe",
        ["/d", "/c", ".\\node_modules\\.bin\\uce.cmd validate --config uce.json --json"],
        { cwd: directory, encoding: "utf8" }
      )
    : execFileSync(
        join(directory, "node_modules", ".bin", "uce"),
        ["validate", "--config", "uce.json", "--json"],
        { cwd: directory, encoding: "utf8" }
      );
  const report = JSON.parse(output);
  if (report.command !== "validate" || report.status !== "ok" || report.schemaVersion !== "0.2") {
    throw new Error("CLI consumer failed.");
  }
}

function prepareScenario(name, workspacePackages, registryDependencies) {
  const directory = join(consumerRoot, name);
  cpSync(join(root, "fixtures", "consumer-matrix", name), directory, { recursive: true });
  const packedDependencies = Object.fromEntries(
    workspacePackages.map((packageName) => [packageName, `file:${packageTarballPath(packageName)}`])
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

function packageTarballPath(packageName) {
  const manifest = JSON.parse(
    readFileSync(join(root, "packages", packageDirectory(packageName), "package.json"), "utf8")
  );
  const baseName = packageName.replace(/^@/, "").replace("/", "-");
  return join(packDir, `${baseName}-${manifest.version}.tgz`);
}

function packageDirectory(packageName) {
  return packageName.split("/").at(-1).replace("universal-config-engine-", "");
}

function runPnpm(args) {
  if (pnpmExecPath !== undefined && pnpmExecPath.length > 0) {
    const isJavaScriptCli = /\.(?:cjs|mjs|js)$/i.test(pnpmExecPath);
    const command = isJavaScriptCli ? process.execPath : pnpmExecPath;
    const commandArgs = isJavaScriptCli ? [pnpmExecPath, ...args] : args;
    execFileSync(command, commandArgs, {
      cwd: root,
      stdio: "inherit",
      shell: process.platform === "win32" && /\.(?:bat|cmd)$/i.test(command)
    });
    return;
  }
  execFileSync("pnpm", args, { cwd: root, stdio: "inherit" });
}

function runNpm(args, cwd) {
  const env = { ...process.env };
  delete env.npm_config_manage_package_manager_versions;
  delete env.NPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS;
  const npmCliPath = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (existsSync(npmCliPath)) {
    execFileSync(process.execPath, [npmCliPath, ...args], { cwd, env, stdio: "inherit" });
    return;
  }
  execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", args, {
    cwd,
    env,
    stdio: "inherit",
    shell: process.platform === "win32"
  });
}
