import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveConfig, runConfigPipeline } from "@0disoft/universal-config-engine-core";
import { loadJsonFileSource } from "../src/index.js";

const descriptor = { id: "json", kind: "json-file" as const, priority: 1, displayName: "json" };

describe("JSON source locations", () => {
  it("uses UTF-8 record bytes, counts replacements once, and accepts the exact budget", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uce-json-location-exact-"));
    try {
      const filePath = join(dir, "config.json");
      await writeFile(filePath, '{"이름":1,"이름":2,"items":[]}');
      const input = { descriptor, filePath };
      const complete = await loadJsonFileSource(input);
      const bytes = complete.locations!.reduce((sum, entry) => sum + Buffer.byteLength(JSON.stringify(entry)), 0);
      const exact = await loadJsonFileSource({ ...input, maxLocationBytes: bytes });
      expect(exact.locations).toEqual(complete.locations);
      expect(exact.issues ?? []).toEqual([]);
      const bounded = await loadJsonFileSource({ ...input, maxLocationBytes: bytes - 1 });
      expect(bounded.locations).toEqual([]);
      expect(bounded.issues).toEqual([expect.objectContaining({
        severity: "warning", code: "max_location_bytes_exceeded", details: { maxLocationBytes: bytes - 1 }
      })]);
      expect(bounded.value).toEqual({ 이름: 2, items: [] });
      expect(resolveConfig({ sources: [bounded] }).ok).toBe(true);
      for (const maxLocationBytes of [NaN, Infinity, 0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
        const fallback = await loadJsonFileSource({ ...input, maxLocationBytes });
        expect(fallback.locations).toEqual(complete.locations);
        expect(fallback.issues ?? []).toEqual([]);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("bounds deep object metadata without rejecting config values", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uce-json-location-budget-"));
    try {
      const filePath = join(dir, "config.json");
      await writeFile(filePath, '{"x":'.repeat(2_000) + "true" + "}".repeat(2_000));
      const loaded = await loadJsonFileSource({ descriptor, filePath });
      expect((loaded.locations ?? []).length).toBe(0);
      expect(loaded.issues).toEqual([expect.objectContaining({
        category: "resource-limit", code: "max_location_bytes_exceeded", severity: "warning", sourceId: "json"
      })]);
      const result = resolveConfig({ sources: [loaded], limits: { maxDepth: 2_000, maxPathLength: 2_000 } });
      expect(result.ok).toBe(true);
      expect(result.resolvedPaths[0]?.path).toHaveLength(2_000);
      expect(result.resolvedPaths[0]?.winningLocation).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("loads deep JSON arrays and reports structural limits instead of a parse failure", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uce-deep-json-file-"));
    try {
      const filePath = join(dir, "config.json");
      await writeFile(filePath, '{"items":' + "[".repeat(6_000) + "true" + "]".repeat(6_000) + "}");
      const loaded = await loadJsonFileSource({ descriptor, filePath });
      expect(loaded.issues ?? []).toEqual([]);
      expect(loaded.locations).toEqual([{ path: ["items"], location: {
        sourceId: "json", sourcePath: await realpath(filePath), line: 1, column: 10
      } }]);
      const rejected = resolveConfig({ sources: [loaded] });
      expect(rejected.ok).toBe(false);
      expect(rejected.issues).toEqual([expect.objectContaining({ category: "resource-limit", code: "max_depth_exceeded" })]);
      const pipeline = await runConfigPipeline({ context: undefined,
        loaders: [{ descriptor, load: () => loaded }], limits: { maxDepth: 6_001, maxPathLength: 6_001 },
        validators: [{ id: "valid", validate: () => ({ ok: true, issues: [] }) }] });
      expect(pipeline.result.ok).toBe(true);
      expect(pipeline.report.status).toBe("ok");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("preserves escaped keys, containers, multiline coordinates and last duplicate locations", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uce-json-coordinates-"));
    try {
      const filePath = join(dir, "config.json");
      await writeFile(filePath, '{\r\n  "\\u0061": {"empty": {}, "value": "first"},\r\n  "items": [{"ignored": ["}\\\"["]}],\r\n  "a": {"value": "last"},\r\n  "after": false\r\n}');
      const loaded = await loadJsonFileSource({ descriptor, filePath });
      expect(loaded.issues ?? []).toEqual([]);
      expect(loaded.locations?.map(({ path, location: { line, column } }) => ({ path, line, column }))).toEqual([
        { path: ["a"], line: 4, column: 8 },
        { path: ["a", "empty"], line: 2, column: 23 },
        { path: ["a", "value"], line: 4, column: 18 },
        { path: ["items"], line: 3, column: 12 },
        { path: ["after"], line: 5, column: 12 }
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
