import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { WORKSPACE_PACKAGE_NAMES, packageDirectory, packageTarballName } from "./workspace-packages.mjs";

export { WORKSPACE_PACKAGE_NAMES, packageDirectory };

export function packageTarballPath(root, packDir, packageName) {
  const manifest = JSON.parse(readFileSync(join(root, "packages", packageDirectory(packageName), "package.json"), "utf8"));
  return join(packDir, packageTarballName(packageName, manifest.version));
}

export function cleanWorkspaceBuild(root) {
  // Only these known generated directories belong to build cleanup. In particular,
  // .tmp may contain release artifacts and must not be recursively removed.
  const workspaceRoot = resolve(root);
  for (const name of WORKSPACE_PACKAGE_NAMES) {
    const generatedPath = join(workspaceRoot, "packages", packageDirectory(name), "dist");
    rmSync(generatedPath, { force: true, recursive: true });
  }
}

export async function withWorkspaceSmoke(root, run) {
  const scratch = mkdtempSync(join(tmpdir(), "uce-package-smoke-"));
  try {
    const packDir = join(scratch, "pack");
    const consumerDir = join(scratch, "consumer");
    mkdirSync(packDir);
    mkdirSync(consumerDir);
    return await run({ packDir, consumerDir });
  } finally {
    try {
      cleanWorkspaceBuild(root);
    } finally {
      rmSync(scratch, { force: true, recursive: true });
    }
  }
}

export function runPnpm(args, cwd = process.cwd()) {
  const cliPath = process.env.npm_execpath;
  const command = cliPath || (process.platform === "win32" ? "pnpm.cmd" : "pnpm");
  const isJavaScriptCli = /\.(?:cjs|mjs|js)$/i.test(command);
  execFileSync(isJavaScriptCli ? process.execPath : command, isJavaScriptCli ? [command, ...args] : args, {
    cwd,
    stdio: "inherit",
    shell: !isJavaScriptCli && process.platform === "win32" && /\.(?:bat|cmd)$/i.test(command)
  });
}

export function npmCompatibleEnvironment(input = process.env) {
  const env = { ...input };
  delete env.npm_config_manage_package_manager_versions;
  delete env.NPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS;
  return env;
}

export function runNpm(args, cwd) {
  const env = npmCompatibleEnvironment();
  const cliPath = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (existsSync(cliPath)) {
    execFileSync(process.execPath, [cliPath, ...args], { cwd, env, stdio: "inherit" });
    return;
  }
  execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", args, {
    cwd,
    env,
    stdio: "inherit",
    shell: process.platform === "win32"
  });
}

// Exercise the installed shell shim as a consumer would. Failure cases separately
// invoke the installed JS entry point so exit statuses and stderr stay observable.
export function runInstalledCli(directory) {
  return process.platform === "win32"
    ? execFileSync("cmd.exe", ["/d", "/c", ".\\node_modules\\.bin\\uce.cmd validate --config uce.json --json"], {
        cwd: directory,
        encoding: "utf8"
      })
    : execFileSync(join(directory, "node_modules", ".bin", "uce"), ["validate", "--config", "uce.json", "--json"], {
        cwd: directory,
        encoding: "utf8"
      });
}
