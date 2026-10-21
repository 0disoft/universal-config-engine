import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { checkPackedCliFailures } from "./check-packed-cli-failures.mjs";

import {
  packageTarballPath,
  runPnpm,
  runNpm,
  runInstalledCli,
  withWorkspaceSmoke
} from "./lib/package-tools.mjs";

const root = process.cwd();
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
      if (!result.ok || report.schemaVersion !== "0.2") {
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
await withWorkspaceSmoke(root, async ({ packDir, consumerDir }) => {
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
      path: packageTarballPath(root, packDir, packageInfo.name)
    });
  }

  smokeConsumerInstall(packedTarballs, consumerDir);
});

function smokeConsumerInstall(tarballs, consumerDir) {
  const tarballDependencies = Object.fromEntries(
    tarballs.map((tarball) => [tarball.name, `file:${tarball.path}`])
  );
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
  copyFileSync(join(root, "fixtures", "consumer", "inspection-types.ts"), join(consumerDir, "inspection-types.ts"));
  copyFileSync(join(root, "fixtures", "consumer", "schema-types.ts"), join(consumerDir, "schema-types.ts"));
  copyFileSync(join(root, "fixtures", "consumer", "file-formats.mjs"), join(consumerDir, "file-formats.mjs"));
  copyFileSync(
    join(root, "fixtures", "consumer", "validator-1.0-types.ts"),
    join(consumerDir, "validator-1.0-types.ts")
  );
  copyFileSync(join(root, "fixtures", "consumer", "tsconfig.json"), join(consumerDir, "tsconfig.json"));
  writeFileSync(
    join(consumerDir, "consumer-smoke.mjs"),
    [
      'import { buildDiagnosticReport, resolveConfig } from "@0disoft/universal-config-engine-core";',
      'import { createProcessEnvSource } from "@0disoft/universal-config-engine-node";',
      'import { createAjvValidator } from "@0disoft/universal-config-engine-validator-ajv";',
      'import { createZodValidator } from "@0disoft/universal-config-engine-validator-zod";',
      'import { z } from "zod";',
      'import { parseCliArgs } from "@0disoft/universal-config-engine-cli";',
      'const mapped = createProcessEnvSource({',
      '  descriptor: { id: "env", kind: "process-env", priority: 10, displayName: "env" },',
      '  env: { APP_PORT: "8080" },',
      '  mappings: [{ externalName: "APP_PORT", sourceKind: "process-env", targetPath: ["service", "port"], parseAs: "number" }]',
      "});",
      "const result = resolveConfig({ sources: [mapped] });",
      "const report = buildDiagnosticReport(result);",
      'if (!result.ok || report.schemaVersion !== "0.2") throw new Error("installed core/node smoke failed");',
      'const ajv = createAjvValidator({ id: "schema", schema: { type: "object" } });',
      "const ajvResult = ajv.validate({ config: result.config, provenance: result.provenance });",
      'if (!ajvResult.ok) throw new Error("installed Ajv validator smoke failed");',
      'const zodValidator = createZodValidator({ id: "zod", schema: z.unknown() });',
      "const zodResult = await zodValidator.validate({ config: result.config, provenance: result.provenance });",
      'if (!zodResult.ok) throw new Error("installed Zod validator smoke failed");',
      'const parsed = parseCliArgs(["validate", "--config", "uce.json", "--json"]);',
      'if (parsed.command !== "validate" || parsed.output !== "json") throw new Error("installed CLI export smoke failed");'
    ].join("\n"),
    "utf8"
  );

  runNpm(["install", "--ignore-scripts"], consumerDir);
  execFileSync(process.execPath, [join(consumerDir, "file-formats.mjs")], { cwd: consumerDir, stdio: "inherit" });
  checkPackedCliFailures(consumerDir);
  assertInstalledPackageReadmes(tarballs, consumerDir);
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
  execFileSync(process.execPath, [join(consumerDir, "dist", "inspection-types.js")], {
    cwd: consumerDir,
    stdio: "inherit"
  });
  execFileSync(process.execPath, [join(consumerDir, "dist", "schema-types.js")], { cwd: consumerDir, stdio: "inherit" });

  const output = runInstalledCli(consumerDir);
  const report = JSON.parse(output);
  if (report.command !== "validate" || report.status !== "ok") {
    throw new Error("Installed CLI binary smoke failed.");
  }
}

function assertInstalledPackageReadmes(tarballs, consumerDir) {
  for (const tarball of tarballs) {
    const packagePath = join(consumerDir, "node_modules", ...tarball.name.split("/"));
    const readmePath = join(packagePath, "README.md");
    if (!existsSync(readmePath)) {
      throw new Error(`${tarball.name} tarball does not include README.md.`);
    }

    const readme = readFileSync(readmePath, "utf8");
    if (!readme.startsWith(`# ${tarball.name}\n`) || !readme.includes("github.com/0disoft/universal-config-engine")) {
      throw new Error(`${tarball.name} README.md does not identify the package and repository.`);
    }
  }
}
