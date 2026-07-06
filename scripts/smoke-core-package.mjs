import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const distIndex = join(root, "packages", "core", "dist", "index.js");
const packDir = join(root, ".tmp", "pack");
const pnpmExecPath = process.env.npm_execpath;

runPnpm(["--filter", "@universal-config-engine/core", "build"]);

if (!existsSync(distIndex)) {
  throw new Error("Core package build did not produce dist/index.js.");
}

const module = await import(pathToFileURL(distIndex).href);
const result = module.resolveConfig({
  sources: [
    {
      descriptor: {
        id: "defaults",
        kind: "object",
        priority: 0,
        displayName: "defaults"
      },
      value: {
        app: {
          port: 3000
        }
      }
    }
  ]
});
const report = module.buildDiagnosticReport(result);

if (!result.ok || report.schemaVersion !== "0.1") {
  throw new Error("Core package ESM smoke import failed.");
}

runPnpm(["--filter", "@universal-config-engine/core", "pack", "--pack-destination", packDir]);

rmSync(join(root, "packages", "core", "dist"), { force: true, recursive: true });
rmSync(join(root, ".tmp"), { force: true, recursive: true });

function runPnpm(args) {
  if (pnpmExecPath !== undefined && pnpmExecPath.length > 0) {
    execFileSync(process.execPath, [pnpmExecPath, ...args], {
      cwd: root,
      stdio: "inherit"
    });
    return;
  }

  execFileSync("pnpm", args, {
    cwd: root,
    stdio: "inherit"
  });
}
