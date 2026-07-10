import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const pnpmExecPath = process.env.npm_execpath;
const packages = [
  {
    name: "@0disoft/universal-config-engine-core",
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
      if (typeof module.loadConfigSources !== "function") {
        throw new Error("Core loader API ESM smoke import failed.");
      }
      if (typeof module.runConfigPipeline !== "function") {
        throw new Error("Core pipeline facade ESM smoke import failed.");
      }
    }
  },
  {
    name: "@0disoft/universal-config-engine-node",
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
    name: "@0disoft/universal-config-engine-cli",
    distIndex: join(root, "packages", "cli", "dist", "index.js"),
    smoke: async (module) => {
      const parsed = module.parseCliArgs(["explain", "--config", "uce.json", "--json"]);
      if (parsed.command !== "explain" || parsed.output !== "json") {
        throw new Error("CLI package ESM smoke import failed.");
      }
      if (typeof module.createDeclaredValidators !== "function") {
        throw new Error("CLI package validator loader export smoke import failed.");
      }
      const mainPath = join(root, "packages", "cli", "dist", "main.js");
      if (!existsSync(mainPath)) {
        throw new Error("CLI package build did not produce dist/main.js.");
      }
    }
  },
  {
    name: "@0disoft/universal-config-engine-validator-zod",
    distIndex: join(root, "packages", "validator-zod", "dist", "index.js"),
    smoke: async (module) => {
      if (typeof module.createZodValidator !== "function") {
        throw new Error("Zod validator package ESM smoke import failed.");
      }
    }
  },
  {
    name: "@0disoft/universal-config-engine-validator-ajv",
    distIndex: join(root, "packages", "validator-ajv", "dist", "index.js"),
    smoke: async (module) => {
      if (typeof module.createAjvValidator !== "function") {
        throw new Error("Ajv validator package ESM smoke import failed.");
      }
    }
  }
];
const packDir = join(root, ".tmp", "pack");
const consumerDir = mkdtempSync(join(tmpdir(), "uce-consumer-"));
const packedTarballs = [];

runPnpm(["-r", "build"]);

for (const packageInfo of packages) {
  if (!existsSync(packageInfo.distIndex)) {
    throw new Error(`${packageInfo.name} build did not produce dist/index.js.`);
  }

  const module = await import(pathToFileURL(packageInfo.distIndex).href);
  await packageInfo.smoke(module);
  runPnpm(["--filter", packageInfo.name, "pack", "--pack-destination", packDir]);
  packedTarballs.push({
    name: packageInfo.name,
    path: packageTarballPath(packageInfo.name)
  });
}

smokeConsumerInstall(packedTarballs);

rmSync(join(root, "packages", "core", "dist"), { force: true, recursive: true });
rmSync(join(root, "packages", "node", "dist"), { force: true, recursive: true });
rmSync(join(root, "packages", "cli", "dist"), { force: true, recursive: true });
rmSync(join(root, "packages", "validator-zod", "dist"), { force: true, recursive: true });
rmSync(join(root, "packages", "validator-ajv", "dist"), { force: true, recursive: true });
rmSync(join(root, ".tmp"), { force: true, recursive: true });
rmSync(consumerDir, { force: true, recursive: true });

function smokeConsumerInstall(tarballs) {
  const tarballDependencies = Object.fromEntries(
    tarballs.map((tarball) => [tarball.name, `file:${tarball.path}`])
  );
  mkdirSync(consumerDir, { recursive: true });
  writeFileSync(
    join(consumerDir, "package.json"),
    `${JSON.stringify(
      {
        private: true,
        type: "module",
        dependencies: tarballDependencies,
        overrides: tarballDependencies
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  copyFileSync(join(root, "examples", "uce.json"), join(consumerDir, "uce.json"));
  copyFileSync(join(root, "examples", "basic-library.mjs"), join(consumerDir, "basic-library.mjs"));
  copyFileSync(join(root, "fixtures", "consumer", "validator-0.2.ts"), join(consumerDir, "validator-0.2.ts"));
  copyFileSync(join(root, "fixtures", "consumer", "tsconfig.json"), join(consumerDir, "tsconfig.json"));
  writeFileSync(
    join(consumerDir, "consumer-smoke.mjs"),
    [
      'import { buildDiagnosticReport, resolveConfig } from "@0disoft/universal-config-engine-core";',
      'import { createProcessEnvSource } from "@0disoft/universal-config-engine-node";',
      'import { createAjvValidator } from "@0disoft/universal-config-engine-validator-ajv";',
      'import { createZodValidator } from "@0disoft/universal-config-engine-validator-zod";',
      'import { parseCliArgs } from "@0disoft/universal-config-engine-cli";',
      'const mapped = createProcessEnvSource({',
      '  descriptor: { id: "env", kind: "process-env", priority: 10, displayName: "env" },',
      '  env: { APP_PORT: "8080" },',
      '  mappings: [{ externalName: "APP_PORT", sourceKind: "process-env", targetPath: ["service", "port"], parseAs: "number" }]',
      "});",
      "const result = resolveConfig({ sources: [mapped] });",
      "const report = buildDiagnosticReport(result);",
      'if (!result.ok || report.schemaVersion !== "0.1") throw new Error("installed core/node smoke failed");',
      'const ajv = createAjvValidator({ id: "schema", schema: { type: "object" } });',
      "const ajvResult = ajv.validate({ config: result.config, provenance: result.provenance });",
      'if (!ajvResult.ok) throw new Error("installed Ajv validator smoke failed");',
      'const zodValidator = createZodValidator({ id: "zod", schema: { safeParse: () => ({ success: true, data: result.config }) } });',
      "const zodResult = zodValidator.validate({ config: result.config, provenance: result.provenance });",
      'if (!zodResult.ok) throw new Error("installed Zod validator smoke failed");',
      'const parsed = parseCliArgs(["validate", "--config", "uce.json", "--json"]);',
      'if (parsed.command !== "validate" || parsed.output !== "json") throw new Error("installed CLI export smoke failed");'
    ].join("\n"),
    "utf8"
  );

  runNpm(["install", "--ignore-scripts"], consumerDir);
  const basicLibraryOutput = execFileSync(process.execPath, [join(consumerDir, "basic-library.mjs")], {
    cwd: consumerDir,
    encoding: "utf8"
  });
  const basicLibraryResult = JSON.parse(basicLibraryOutput);
  if (
    basicLibraryResult.status !== "ok" ||
    basicLibraryResult.port !== 8080 ||
    basicLibraryResult.winningSourceId !== "local"
  ) {
    throw new Error("Installed basic library example failed.");
  }
  execFileSync(process.execPath, [join(consumerDir, "consumer-smoke.mjs")], {
    cwd: consumerDir,
    stdio: "inherit"
  });
  execFileSync(
    process.execPath,
    [join(root, "node_modules", "typescript", "bin", "tsc"), "-p", join(consumerDir, "tsconfig.json")],
    {
      cwd: consumerDir,
      stdio: "inherit"
    }
  );
  execFileSync(process.execPath, [join(consumerDir, "dist", "validator-0.2.js")], {
    cwd: consumerDir,
    stdio: "inherit"
  });

  const uceBin = join(consumerDir, "node_modules", ".bin", process.platform === "win32" ? "uce.cmd" : "uce");
  const output =
    process.platform === "win32"
      ? execFileSync("cmd.exe", ["/d", "/c", ".\\node_modules\\.bin\\uce.cmd validate --config uce.json --json"], {
          cwd: consumerDir,
          encoding: "utf8"
        })
      : execFileSync(uceBin, ["validate", "--config", "uce.json", "--json"], {
          cwd: consumerDir,
          encoding: "utf8"
        });
  const report = JSON.parse(output);
  if (report.command !== "validate" || report.status !== "ok") {
    throw new Error("Installed CLI binary smoke failed.");
  }
}

function packageTarballPath(packageName) {
  const packageJsonPath = join(root, "packages", packageName.split("/").at(-1).replace("universal-config-engine-", ""), "package.json");
  const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const tarballBaseName = packageName.replace(/^@/, "").replace("/", "-");
  return join(packDir, `${tarballBaseName}-${manifest.version}.tgz`);
}

function runPnpm(args, cwd = root) {
  if (pnpmExecPath !== undefined && pnpmExecPath.length > 0) {
    const isJavaScriptCli = /\.(?:cjs|mjs|js)$/i.test(pnpmExecPath);
    const command = isJavaScriptCli ? process.execPath : pnpmExecPath;
    const commandArgs = isJavaScriptCli ? [pnpmExecPath, ...args] : args;
    execFileSync(command, commandArgs, {
      cwd,
      stdio: "inherit",
      shell: process.platform === "win32" && /\.(?:bat|cmd)$/i.test(command)
    });
    return;
  }

  execFileSync("pnpm", args, {
    cwd,
    stdio: "inherit"
  });
}

function runNpm(args, cwd) {
  const npmCliPath = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (existsSync(npmCliPath)) {
    execFileSync(process.execPath, [npmCliPath, ...args], {
      cwd,
      stdio: "inherit"
    });
    return;
  }

  execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32"
  });
}
