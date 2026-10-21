import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { packageTarballPath, runNpm, runPnpm, withWorkspaceSmoke } from "./lib/package-tools.mjs";

const root = process.cwd();
const requested = process.argv.slice(2);
if (requested.some(arg => !arg.startsWith("--runtimes=")) || requested.length > 1) throw new Error("Use --runtimes=node,bun,deno,workerd.");
const runtimes = (requested[0]?.slice("--runtimes=".length) ?? "node,bun,deno,workerd").split(",");
if (runtimes.length === 0 || new Set(runtimes).size !== runtimes.length || runtimes.some(name => !["node", "bun", "deno", "workerd"].includes(name))) {
  throw new Error("Select unique supported runtime names.");
}
const binaries = { node: process.execPath, bun: process.env.UCE_BUN_BIN ?? "bun", deno: process.env.UCE_DENO_BIN ?? "deno", workerd: process.env.UCE_WORKERD_BIN ?? "workerd" };
const invoke = (binary, args, cwd) => execFileSync(binary, args, { cwd, encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true });
// Fail early, with no downloads or pretend passes when a selected runtime is missing.
const versions = Object.fromEntries(runtimes.map(name => [name, invoke(binaries[name], ["--version"], root).trim().split(/\r?\n/)[0]]));
const evidence = await withWorkspaceSmoke(root, async ({ packDir, consumerDir }) => {
  const packageName = "@0disoft/universal-config-engine-core";
  runPnpm(["--filter", packageName, "build"]);
  runPnpm(["--filter", packageName, "pack", "--pack-destination", packDir]);
  writeFileSync(join(consumerDir, "package.json"), JSON.stringify({ private: true, type: "module", dependencies: {
    [packageName]: `file:${packageTarballPath(root, packDir, packageName).replaceAll("\\", "/")}`
  } }));
  runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund"], consumerDir);
  copyFileSync(join(root, "fixtures/consumer/portable-core.mjs"), join(consumerDir, "portable-core.mjs"));
  writeFileSync(join(consumerDir, "entry.mjs"), `import * as core from "${packageName}";\nimport { exercisePortableCore } from "./portable-core.mjs";\nconsole.log(JSON.stringify(await exercisePortableCore(core)));\n`);
  const installed = join(consumerDir, "node_modules", ...packageName.split("/"), "dist");
  const moduleDirectory = join(consumerDir, "core"); mkdirSync(moduleDirectory);
  const modules = [ '(name = "entry", esModule = embed "worker.mjs")', '(name = "portable-core.mjs", esModule = embed "portable-core.mjs")' ];
  for (const name of readdirSync(installed).filter(name => name.endsWith(".js"))) {
    copyFileSync(join(installed, name), join(moduleDirectory, name));
    modules.push(`(name = ${JSON.stringify(`core/${name}`)}, esModule = embed ${JSON.stringify(`core/${name}`)})`);
  }
  writeFileSync(join(consumerDir, "worker.mjs"), 'import * as core from "./core/index.js";\nimport { exercisePortableCore } from "./portable-core.mjs";\nexport default { async test() { const result = await exercisePortableCore(core); if (result.status !== "ok") throw new Error("Worker consumer failed."); } };\n');
  writeFileSync(join(consumerDir, "worker.capnp"), `using Workerd = import "/workerd/workerd.capnp";\nconst config :Workerd.Config = (services = [(name = "core-consumer", worker = (compatibilityDate = "2026-10-21", modules = [${modules.join(",\n")}]))]);\n`);
  const results = [];
  for (const name of runtimes) {
    const args = name === "deno" ? ["run", "--no-config", "--no-prompt", "--node-modules-dir=manual", "--cached-only", "entry.mjs"]
      : name === "workerd" ? ["test", "worker.capnp"] : ["entry.mjs"];
    const output = invoke(binaries[name], args, consumerDir);
    if (name !== "workerd" && JSON.parse(output.trim()).checks.length !== 7) throw new Error(`${name} consumer did not complete its checks.`);
    results.push({ runtime: name, version: versions[name], status: "passed", checks: 7 });
  }
  return { schemaVersion: "portable-runtime-evidence-1", artifactVersion: JSON.parse(readFileSync(join(installed, "../package.json"), "utf8")).version,
    tarballSha256: createHash("sha256").update(readFileSync(packageTarballPath(root, packDir, packageName))).digest("hex"),
    platform: process.platform, architecture: process.arch,
    compatibilityDate: "2026-10-21", nodeCompatibilityFlags: false, results };
});
mkdirSync(resolve(root, ".tmp"), { recursive: true });
writeFileSync(join(root, ".tmp/portable-runtime-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));
