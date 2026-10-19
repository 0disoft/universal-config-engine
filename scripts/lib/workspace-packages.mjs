// Dependency order is shared by publication, release checks and consumer smokes.
export const WORKSPACE_PACKAGE_NAMES = Object.freeze([
  "@0disoft/universal-config-engine-core",
  "@0disoft/universal-config-engine-node",
  "@0disoft/universal-config-engine-validator-ajv",
  "@0disoft/universal-config-engine-validator-zod",
  "@0disoft/universal-config-engine-cli"
]);

export function packageDirectory(packageName) {
  if (!WORKSPACE_PACKAGE_NAMES.includes(packageName)) {
    throw new Error(`Unknown workspace package: ${packageName}`);
  }
  return packageName.split("/").at(-1).replace("universal-config-engine-", "");
}

export function packageTarballName(packageName, version) {
  packageDirectory(packageName);
  return `${packageName.replace(/^@/, "").replace("/", "-")}-${version}.tgz`;
}
