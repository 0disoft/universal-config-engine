import { expect, it } from "vitest";
import fc from "fast-check";
import { compileRedaction } from "../src/compiled-redaction.js";
import { DEFAULT_SECRET_NAME_PATTERNS, type BuildDiagnosticReportOptions } from "../src/redaction.js";
import { isPathPrefix } from "../src/path.js";
import type { ConfigPath, ConfigSourceDescriptor } from "../src/types.js";

it("retains ordered policy reasons for typed prefixes, literal names, Unicode and atomic owners", () => {
  const path = fc.array(fc.constantFrom<string | number>("password", "a.b", "a", "0", 0, "Σ", "A"), { maxLength: 4 });
  const policy = fc.record({ secretPaths: fc.array(path, { maxLength: 4 }),
    secretNamePatterns: fc.array(fc.constantFrom("pass", "Σ", "σ", "ς", "A.B", "[a]", "", "0"), { maxLength: 4 }) });
  fc.assert(fc.property(fc.array(policy, { maxLength: 5 }), policy, fc.array(path, { maxLength: 3 }), path,
    (policies, options, owned, query) => {
      const sources: ConfigSourceDescriptor[] = policies.map((redaction, index) => ({
        id: `source-${index}`, displayName: "source", kind: "object", priority: index, redaction
      }));
      expect(compileRedaction(sources, options, DEFAULT_SECRET_NAME_PATTERNS, owned)(query))
        .toEqual(reference(sources, options, owned, query));
    }), { numRuns: 300 });
});

function reference(sources: readonly ConfigSourceDescriptor[], options: BuildDiagnosticReportOptions,
  owned: readonly ConfigPath[], path: ConfigPath) {
  if (owned.some(prefix => isPathPrefix(prefix, path))) return { redacted: true, reason: "secret-source" };
  const pathMatch = (paths: readonly ConfigPath[] | undefined) => paths?.some(prefix => isPathPrefix(prefix, path));
  const nameMatch = (patterns: readonly string[] | undefined) => patterns?.some(pattern =>
    [path.map(String).join("."), String(path.at(-1) ?? "")].some(name => name.toLowerCase().includes(pattern.toLowerCase())));
  for (const source of [...sources, undefined]) {
    if (pathMatch(source?.redaction?.secretPaths) || pathMatch(options.secretPaths)) return { redacted: true, reason: "secret-path" };
    if (nameMatch(source?.redaction?.secretNamePatterns) || nameMatch(options.secretNamePatterns) || nameMatch(DEFAULT_SECRET_NAME_PATTERNS)) {
      return { redacted: true, reason: "secret-name" };
    }
  }
  return { redacted: false };
}
