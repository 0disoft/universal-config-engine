import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "@0disoft/universal-config-engine-core";
import { loadConfigFileSource, type ConfigFileFormat, type LoadConfigFileSourceInput } from "../src/index.js";

async function load(format: ConfigFileFormat, text: string, options: Partial<LoadConfigFileSourceInput> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "uce-dialect-"));
  try {
    const filePath = join(directory, "config");
    await writeFile(filePath, text, "utf8");
    return await loadConfigFileSource({ descriptor: { id: "file", kind: "adapter", priority: 1, displayName: "file" },
      filePath, format, ...options });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("official configuration file formats", () => {
  it.each(['{"items":[,]}', '{,}', '{"items":[1,,]}'])(
    "rejects JSONC elisions even when trailing commas are enabled: %s", async text => {
      const loaded = await load("jsonc", text, { allowTrailingComma: true });
      expect(loaded.value).toEqual({});
      expect(loaded.issues?.[0]?.code).toBe("config_file_parse_failed");
    }
  );

  it("accepts trailing commas after real JSONC values", async () => {
    const loaded = await load("jsonc", '{"items":[1, /* comment */],}', { allowTrailingComma: true });
    expect(loaded.value).toEqual({ items: [1] });
    expect(loaded.issues).toBeUndefined();
  });

  it.each([
    ["json", '{"service":{"port":8080}}'],
    ["jsonc", '{/* comment */ "service":{"port":8080}}'],
    ["yaml", 'service:\n  port: 8080\n'],
    ["toml", '[service]\nport = 8080\n'],
    ["json5", "{service:{port:8080,},}"]
  ] as const)("loads %s through the existing resolution contract", async (format, text) => {
    const loaded = await load(format, text);
    const result = resolveConfig({ sources: [loaded] });
    expect(result.ok).toBe(true);
    expect(result.config).toEqual({ service: { port: 8080 } });
    expect(result.resolvedPaths[0]?.winningSourceId).toBe("file");
  });

  it.each(["jsonc", "yaml", "toml", "json5"] as const)("contains %s parser exceptions and raw input", async format => {
    const loaded = await load(format, "[= UCE_DIALECT_PRIVATE_SENTINEL");
    expect(loaded.value).toEqual({});
    expect(loaded.issues).toEqual([expect.objectContaining({ category: "parse", code: "config_file_parse_failed" })]);
    expect(JSON.stringify(loaded)).not.toContain("UCE_DIALECT_PRIVATE_SENTINEL");
  });

  it.each([
    ["jsonc", '{"__proto__":{"polluted":true}}'],
    ["yaml", '__proto__:\n  polluted: true\n'],
    ["toml", '[__proto__]\npolluted = true\n'],
    ["json5", '{__proto__:{polluted:true}}']
  ] as const)("rejects %s unsafe keys without partial values", async (format, text) => {
    const loaded = await load(format, text);
    expect(loaded.value).toEqual({});
    expect(loaded.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "unsafe_key" })]));
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
  });

  it.each([
    ["jsonc", '{"number":1e999}'], ["json5", '{number:NaN}'],
    ["yaml", 'number: .inf\n'], ["toml", 'number = nan\n'],
    ["toml", 'date = 1979-05-27T07:32:00Z\n']
  ] as const)("rejects non-JSON values from %s", async (format, text) => {
    const loaded = await load(format, text);
    expect(loaded.value).toEqual({});
    expect(loaded.issues?.some(issue => issue.severity === "error")).toBe(true);
  });

  it("retains JSONC coordinates and makes trailing commas an explicit policy", async () => {
    const text = '{\n // note\n "port": 80,\n}';
    expect((await load("jsonc", text)).issues?.[0]?.code).toBe("config_file_parse_failed");
    const accepted = await load("jsonc", text, { allowTrailingComma: true });
    expect(accepted.value).toEqual({ port: 80 });
    expect(accepted.locations).toEqual([expect.objectContaining({ path: ["port"],
      location: expect.objectContaining({ line: 3, column: 10 }) })]);
    expect((await load("json", text)).issues?.[0]?.code).toBe("json_parse_failed");
  });

  it.each([
    'port: 80\nport: 443\n', 'base: &base {port: 80}\ncopy: *base\n', 'value: !custom text\n'
  ])("rejects YAML duplicates, aliases and unknown tags", async text => {
    expect((await load("yaml", text)).issues?.[0]?.code).toBe("config_file_parse_failed");
  });

  it.each(["jsonc", "yaml", "toml", "json5"] as const)("enforces byte and structural budgets for %s", async format => {
    const loaded = await load(format, "x".repeat(20), { maxFileBytes: 4 });
    expect(loaded.issues?.[0]?.code).toBe("max_file_bytes_exceeded");
    const text = format === "toml" ? "a.b.c = 1" : format === "yaml" ? "a: {b: {c: 1}}" : '{"a":{"b":{"c":1}}}';
    const nested = await load(format, text, { limits: { maxDepth: 1 } });
    expect(nested.value).toEqual({});
    expect(nested.issues?.[0]?.category).toBe("resource-limit");
  });

  it.each(["jsonc", "json5"] as const)("bounds %s parser recursion before execution", async format => {
    const loaded = await load(format, '{"a":'.repeat(10000) + '1' + '}'.repeat(10000));
    expect(loaded.issues?.[0]?.code).toBe("max_parse_depth_exceeded");
  });

  it("does not count JSON5 brackets inside strings or comments", async () => {
    const loaded = await load("json5", "{text:'" + "[".repeat(1000) + "', /* { [ */ port:80}");
    expect(loaded.issues).toBeUndefined();
    expect(resolveConfig({ sources: [loaded] }).ok).toBe(true);
  });

  it.each(['{"port":80} /* unterminated', '{"port":80,}', '{"port":80,,}', '{"port":80, /* note */ "x":}'])(
    "rejects malformed JSONC instead of retaining a partial object", async text => {
      const loaded = await load("jsonc", text);
      expect(loaded.value).toEqual({});
      expect(loaded.issues?.[0]?.code).toBe("config_file_parse_failed");
    }
  );
});
