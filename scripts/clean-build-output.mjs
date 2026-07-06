import { rmSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const generatedPaths = [
  join(root, "packages", "core", "dist"),
  join(root, "packages", "node", "dist"),
  join(root, ".tmp")
];

for (const generatedPath of generatedPaths) {
  rmSync(generatedPath, { force: true, recursive: true });
}
