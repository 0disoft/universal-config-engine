import { expect, it } from "vitest";
import { loadDeclaredSources } from "../src/pipeline/source-loading.js";
import type { PipelineSourceDeclaration } from "../src/types.js";

it("deduplicates secret paths in first-seen order without conflating typed or dotted paths", async () => {
  const paths = [["first"], ["a.b"], ["a", "b"], ["items", 0], ["items", "0"]];
  const source: PipelineSourceDeclaration = { id: "env", kind: "process-env", priority: 0,
    redaction: { secretPaths: paths, secretNamePatterns: ["private"] },
    mappings: [["a", "b"], ["last"], ["first"], ["last"]].map((targetPath, index) => ({
      externalName: `KEY_${index}`, targetPath, sourceKind: "process-env", secret: true
    })) };
  const before = structuredClone(source);
  const loaded = await loadDeclaredSources({ declaration: { sources: [source] }, configPath: "unused",
    cwd: process.cwd(), env: {}, argv: [] });
  expect(loaded[0]?.descriptor.redaction).toEqual({ secretPaths: [...paths, ["last"]], secretNamePatterns: ["private"] });
  expect(source).toEqual(before);
});
