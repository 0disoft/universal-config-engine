import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const pnpmExecPath = process.env.npm_execpath;
const packages = [
  {
    name: "@universal-config-engine/core",
    distIndex: join(root, "packages", "core", "dist", "index.js"),
    smoke: async (module) => {
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
        throw new Error("Core ESM smoke import failed.");
      }
    }
  },
  {
    name: "@universal-config-engine/node",
    distIndex: join(root, "packages", "node", "dist", "index.js"),
    smoke: async (module) => {
      const source = module.createProcessEnvSource({
        descriptor: {
          id: "env",
          kind: "process-env",
          priority: 1,
          displayName: "env"
        },
        env: {
          APP_PORT: "3000"
        },
        mappings: [
          {
            externalName: "APP_PORT",
            sourceKind: "process-env",
            targetPath: ["app", "port"],
            parseAs: "number"
          }
        ]
      });
      if (source.issues.length !== 0 || source.value.app.port !== 3000) {
        throw new Error("Node package ESM smoke import failed.");
      }
    }
  },
  {
    name: "@universal-config-engine/cli",
    distIndex: join(root, "packages", "cli", "dist", "index.js"),
    smoke: async (module) => {
      const parsed = module.parseCliArgs(["explain", "--config", "uce.json", "--json"]);
      if (parsed.command !== "explain" || parsed.output !== "json") {
        throw new Error("CLI package ESM smoke import failed.");
      }
      const mainPath = join(root, "packages", "cli", "dist", "main.js");
      if (!existsSync(mainPath)) {
        throw new Error("CLI package build did not produce dist/main.js.");
      }
    }
  },
  {
    name: "@universal-config-engine/validator-zod",
    distIndex: join(root, "packages", "validator-zod", "dist", "index.js"),
    smoke: async (module) => {
      if (typeof module.createZodValidator !== "function") {
        throw new Error("Zod validator package ESM smoke import failed.");
      }
    }
  },
  {
    name: "@universal-config-engine/validator-ajv",
    distIndex: join(root, "packages", "validator-ajv", "dist", "index.js"),
    smoke: async (module) => {
      if (typeof module.createAjvValidator !== "function") {
        throw new Error("Ajv validator package ESM smoke import failed.");
      }
    }
  }
];
const packDir = join(root, ".tmp", "pack");

runPnpm(["-r", "build"]);

for (const packageInfo of packages) {
  if (!existsSync(packageInfo.distIndex)) {
    throw new Error(`${packageInfo.name} build did not produce dist/index.js.`);
  }

  const module = await import(pathToFileURL(packageInfo.distIndex).href);
  await packageInfo.smoke(module);
  runPnpm(["--filter", packageInfo.name, "pack", "--pack-destination", packDir]);
}

rmSync(join(root, "packages", "core", "dist"), { force: true, recursive: true });
rmSync(join(root, "packages", "node", "dist"), { force: true, recursive: true });
rmSync(join(root, "packages", "cli", "dist"), { force: true, recursive: true });
rmSync(join(root, "packages", "validator-zod", "dist"), { force: true, recursive: true });
rmSync(join(root, "packages", "validator-ajv", "dist"), { force: true, recursive: true });
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
