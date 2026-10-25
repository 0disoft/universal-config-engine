import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildDiagnosticReport, buildPublicDiagnosticReport, resolveConfig } from "@0disoft/universal-config-engine-core";
import { loadConfigFileSource, type ConfigFileFormat, type LoadConfigFileSourceInput } from "../src/index.js";
import { configFileParseDiagnostic } from "../src/config-file-diagnostics.js";

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
  it.each([
    ["yaml", "port: 80\nport: 443\n", "duplicate-key", 2, 1],
    ["yaml", "base: &base {port: 80}\ncopy: *base\n", "unsupported-alias", 2, 7],
    ["yaml", "value: !custom UCE_PRIVATE\n", "unsupported-tag", 1, 8],
    ["yaml", "port: 80\n---\nport: 443\n", "multiple-documents", 2, 1],
    ["yaml", "service:\r\n  ports: [80,\r\n", "syntax", 3, 1],
    ["yaml", 'text: "한😀"\r\nvalue: [', "syntax", 2, 9],
    ["toml", "port = 80\r\nvalue = @UCE_PRIVATE\r\n", "syntax", 2, 9],
    ["json5", "{\r\n password: 'UCE_PRIVATE',\r\n value: @\r\n}", "syntax", 3, 9],
    ["json5", "{value:'bad\n'}", "syntax", 2, 1],
    ["json5", "{한:'😀', value:@}", "syntax", 1, 16],
    ["toml", "value =", "syntax", 1, 8],
    ["json5", "{", "syntax", 1, 2]
  ] as const)("reports safe %s syntax metadata (%s)", async (format, text, reason, line, column) => {
    const onError = vi.fn();
    const loaded = await load(format, text, { onError });
    expect(loaded.value).toEqual({});
    expect(loaded.issues?.[0]).toMatchObject({ category: "parse", code: "config_file_parse_failed",
      details: { format, reason, line, column } });
    expect(loaded.issues?.[0]?.message).toContain(`line ${line}, column ${column}`);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0].error.cause).toBeInstanceOf(Error);
    expect(JSON.stringify(loaded)).not.toContain("UCE_PRIVATE");
  });

  it.each([
    ["yaml", 'UCE_PRIVATE_KEY: UCE_PRIVATE_VALUE\nUCE_PRIVATE_KEY: other\n'],
    ["toml", 'password = "UCE_PRIVATE_VALUE"\nUCE_PRIVATE_KEY = @\n'],
    ["json5", "{password:'UCE_PRIVATE_VALUE', UCE_PRIVATE_KEY:@}"]
  ] as const)("keeps %s raw input out of ordinary, secret-source and public-share diagnostics", async (format, text) => {
    const loaded = await load(format, text);
    const report = buildDiagnosticReport(resolveConfig({ sources: [loaded] }));
    expect(report.issues[0]?.details?.format).toBe(format);
    const secret = { ...loaded, descriptor: { ...loaded.descriptor, redaction: { secretSource: true } } };
    const secretReport = buildDiagnosticReport(resolveConfig({ sources: [secret] }));
    expect(secretReport.issues[0]?.details).toBeUndefined();
    const shared = buildPublicDiagnosticReport(report);
    expect(shared.issues[0]).not.toHaveProperty("details");
    expect(JSON.stringify([loaded, report, secretReport, shared])).not.toContain("UCE_PRIVATE");
  });

  it.each([undefined, NaN, Infinity, -1, 0, 1.5, Number.MAX_SAFE_INTEGER])(
    "omits invalid native parser coordinates (%s)", value => {
      const error = Object.assign(new Error("UCE_PRIVATE"), { line: value, column: value, lineNumber: value, columnNumber: value });
      for (const format of ["toml", "json5"] as const) {
        expect(configFileParseDiagnostic(format, "x", error).details).toEqual({ format, reason: "parse-failed" });
      }
    });

  it("ignores unknown parser codes, out-of-range YAML offsets and error accessors", () => {
    for (const offset of [-1, 1.5, Infinity, 3]) {
      const error = Object.assign(new Error("UCE_PRIVATE"), { code: "UCE_PRIVATE", pos: [offset, offset] });
      expect(configFileParseDiagnostic("yaml", "x", error).details).toEqual({ format: "yaml", reason: "parse-failed" });
    }
    const getter = vi.fn(() => { throw new Error("UCE_PRIVATE"); });
    const error = Object.defineProperty(new Error("UCE_PRIVATE"), "lineNumber", { get: getter });
    expect(configFileParseDiagnostic("json5", "x", error).details).toEqual({ format: "json5", reason: "parse-failed" });
    expect(getter).not.toHaveBeenCalled();
    expect(configFileParseDiagnostic("toml", "x", undefined).details).toEqual({ format: "toml", reason: "parse-failed" });
  });

  it("does not misclassify internal parser failures as syntax errors or lose their private cause", async () => {
    const { default: JSON5 } = await import("json5");
    const cause = new TypeError("UCE_PRIVATE_INTERNAL");
    const parser = vi.spyOn(JSON5, "parse").mockImplementation(() => { throw cause; });
    const onError = vi.fn();
    try {
      const loaded = await load("json5", "{}", { onError });
      expect(loaded.issues?.[0]?.details).toEqual({ format: "json5", reason: "parse-failed" });
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0]?.[0].error.cause).toBe(cause);
      expect(JSON.stringify(loaded)).not.toContain("UCE_PRIVATE");
    } finally { parser.mockRestore(); }
  });

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

  it("stops deeply nested YAML before consuming the entire token stream", async () => {
    const { Parser } = await import("yaml");
    const next = vi.spyOn(Parser.prototype, "next");
    const onError = vi.fn();
    try {
      const loaded = await load("yaml", "value: " + "[".repeat(10000) + "0" + "]".repeat(10000), { onError });
      expect(loaded.value).toEqual({});
      expect(loaded.issues?.[0]).toMatchObject({ category: "resource-limit", code: "max_parse_depth_exceeded" });
      expect(next.mock.calls.length).toBeLessThan(128);
      expect(onError).not.toHaveBeenCalled();
    } finally {
      next.mockRestore();
    }
  });

  it.each([255, 256])("enforces the YAML parser ceiling at %i nested arrays", async depth => {
    const loaded = await load("yaml", "value: " + "[".repeat(depth) + "0" + "]".repeat(depth),
      { limits: { maxDepth: 512, maxPathLength: 512 } });
    if (depth === 255) expect(loaded.issues).toBeUndefined();
    else expect(loaded.issues?.[0]?.code).toBe("max_parse_depth_exceeded");
  });

  it("bounds YAML block mappings before recursive document composition", async () => {
    const text = Array.from({ length: 100 }, (_, index) => "  ".repeat(index) + "value:").join("\n") + "\n";
    expect((await load("yaml", text)).issues?.[0]?.code).toBe("max_parse_depth_exceeded");
  });

  it.each([
    "text: '" + "[".repeat(1000) + "'\n",
    'text: "' + "{".repeat(1000) + '"\n',
    "# " + "[".repeat(1000) + "\ntext: ok\n",
    "text: |\n  " + "[".repeat(1000) + "\n",
    "text: >\n  " + "{".repeat(1000) + "\n"
  ])("does not count YAML scalar or comment brackets as collections", async text => {
    expect((await load("yaml", text, { limits: { maxDepth: 1 } })).issues).toBeUndefined();
  });

  it("still rejects YAML multiple documents without retaining partial values", async () => {
    const loaded = await load("yaml", "port: 80\n---\nport: 443\n");
    expect(loaded.value).toEqual({});
    expect(loaded.issues?.[0]?.code).toBe("config_file_parse_failed");
  });

  it.each(['{"port":80} /* unterminated', '{"port":80,}', '{"port":80,,}', '{"port":80, /* note */ "x":}'])(
    "rejects malformed JSONC instead of retaining a partial object", async text => {
      const loaded = await load("jsonc", text);
      expect(loaded.value).toEqual({});
      expect(loaded.issues?.[0]?.code).toBe("config_file_parse_failed");
    }
  );
});
