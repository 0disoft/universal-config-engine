import {
  DEFAULT_RESOURCE_LIMITS, flattenConfigObject,
  type ConfigIssue, type LoadedSource, type ResourceLimitPolicy
} from "@0disoft/universal-config-engine-core";
import { loadTextFileSource } from "./file-source.js";
import { loadJsonFileSource, type LoadJsonFileSourceInput } from "./json-file-loader.js";
import { JSON_TOKEN, JSON_SCAN_ERROR_NONE } from "./jsonc-tokens.js";
import { collectJsonLocations, DEFAULT_MAX_LOCATION_BYTES } from "./json-locations.js";
import { positiveSafeIntegerLimit } from "./limits.js";

export type ConfigFileFormat = "json" | "jsonc" | "yaml" | "toml" | "json5";

const MAX_RECURSIVE_PARSE_DEPTH = 256;

export interface LoadConfigFileSourceInput extends LoadJsonFileSourceInput {
  readonly format: ConfigFileFormat;
  readonly limits?: Partial<ResourceLimitPolicy>;
  /** JSONC only; false by default, independently of comment support. */
  readonly allowTrailingComma?: boolean;
}

/** First-party parsers share the bounded, opened-file I/O boundary. */
export async function loadConfigFileSource(input: LoadConfigFileSourceInput): Promise<LoadedSource> {
  if (input.format === "json") return loadJsonFileSource(input);
  const limits = Object.fromEntries(Object.entries(DEFAULT_RESOURCE_LIMITS).map(([key, fallback]) =>
    [key, positiveSafeIntegerLimit(input.limits?.[key as keyof ResourceLimitPolicy], fallback)])) as unknown as ResourceLimitPolicy;
  return loadTextFileSource(input, {
    readFailure: { category: "source-load", code: "config_file_read_failed",
      message: "Failed to read configuration file. Exception details were omitted." },
    parseFailure: { category: "parse", code: "config_file_parse_failed",
      message: "Failed to parse configuration file. Exception details were omitted." },
    async parse(raw, canonicalPath) {
      // The recursive dialect parsers must not consume unbounded nesting before
      // core can validate their output. JSON uses its existing iterative boundary.
      if ((input.format === "jsonc" || input.format === "json5") &&
          exceedsJsonLikeDepth(raw, Math.min(limits.maxDepth + 1, MAX_RECURSIVE_PARSE_DEPTH))) {
        return failure(input, { category: "resource-limit", code: "max_parse_depth_exceeded",
          message: "Configuration nesting exceeds the parser depth budget." });
      }
      const value = await parseDialect(raw, input);
      const checked = flattenConfigObject(input.descriptor.id, value, limits);
      if (checked.issues.some(issue => issue.severity === "error")) {
        return { descriptor: input.descriptor, value: {}, issues: checked.issues };
      }
      const locations = input.format === "jsonc" ? collectJsonLocations(
        input.descriptor.id, canonicalPath, raw,
        positiveSafeIntegerLimit(input.maxLocationBytes, DEFAULT_MAX_LOCATION_BYTES)) : {};
      return { descriptor: input.descriptor, value, ...locations };
    }
  });
}

async function parseDialect(raw: string, input: LoadConfigFileSourceInput): Promise<unknown> {
  switch (input.format) {
    case "jsonc": {
      const { createScanner, visit } = await import("jsonc-parser");
      // Validate grammar before removing commas: empty elisions are never trailing commas.
      visit(raw, { onError: () => { throw new Error("Invalid JSONC syntax."); } },
        { allowTrailingComma: input.allowTrailingComma === true });
      const scanner = createScanner(raw, false);
      const commas: number[] = [];
      const uncommented: string[] = [];
      let commentStart = 0;
      let previous: number = JSON_TOKEN.Unknown;
      let previousOffset = 0;
      for (let token = scanner.scan(); ; token = scanner.scan()) {
        if (scanner.getTokenError() !== JSON_SCAN_ERROR_NONE) throw new Error("Invalid JSONC token.");
        if (token === JSON_TOKEN.EOF) break;
        // Comments and whitespace do not separate a trailing comma from its close.
        if (token === JSON_TOKEN.LineCommentTrivia || token === JSON_TOKEN.BlockCommentTrivia) {
          const offset = scanner.getTokenOffset();
          const end = offset + scanner.getTokenLength();
          // Use actual source slices: scanner token values are not guaranteed
          // to have the original token's length. Locations must keep offsets.
          uncommented.push(raw.slice(commentStart, offset), raw.slice(offset, end).replace(/[^\r\n]/g, " "));
          commentStart = end;
          continue;
        }
        if (token === JSON_TOKEN.LineBreakTrivia || token === JSON_TOKEN.Trivia) continue;
        if (input.allowTrailingComma === true && previous === JSON_TOKEN.CommaToken &&
            (token === JSON_TOKEN.CloseBraceToken || token === JSON_TOKEN.CloseBracketToken)) commas.push(previousOffset);
        previous = token;
        previousOffset = scanner.getTokenOffset();
      }
      uncommented.push(raw.slice(commentStart));
      const clean = uncommented.join("");
      const chunks: string[] = [];
      let start = 0;
      for (const offset of commas) {
        chunks.push(clean.slice(start, offset), " ");
        start = offset + 1;
      }
      chunks.push(clean.slice(start));
      // Native parsing preserves unsafe own keys for core's rejection and does
      // not build attacker-controlled prototypes through parser assignments.
      return JSON.parse(chunks.join("")) as unknown;
    }
    case "yaml": {
      const { parseDocument } = await import("yaml");
      const document = parseDocument(raw, { version: "1.2", uniqueKeys: true, stringKeys: true });
      if (document.errors.length > 0 || document.warnings.length > 0) throw new Error("Invalid YAML.");
      return document.toJS({ maxAliasCount: 0 });
    }
    case "toml": {
      const { parse } = await import("smol-toml");
      // Preserve unsafe own keys for core's explicit unsafe_key diagnostic.
      // Date/time instances and infinities are rejected by structural validation.
      return parse(raw);
    }
    case "json5": {
      const { default: JSON5 } = await import("json5");
      return JSON5.parse(raw) as unknown;
    }
    default: throw new Error("Unsupported configuration format.");
  }
}

function failure(input: LoadConfigFileSourceInput, issue: Pick<ConfigIssue, "category" | "code" | "message">): LoadedSource {
  return { descriptor: input.descriptor, value: {},
    issues: [{ ...issue, severity: "error", sourceId: input.descriptor.id }] };
}

/** Scan lexical nesting without recursion, ignoring strings and comments. */
function exceedsJsonLikeDepth(raw: string, maximum: number): boolean {
  let depth = 0;
  let quote: string | undefined;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (quote !== undefined) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "/" && raw[index + 1] === "/") {
      while (index < raw.length && !["\n", "\r", "\u2028", "\u2029"].includes(raw[index]!)) index += 1;
    } else if (char === "/" && raw[index + 1] === "*") {
      const end = raw.indexOf("*/", index + 2);
      if (end === -1) return false; // The parser reports malformed comments.
      index = end + 1;
    } else if (char === "{" || char === "[") {
      if (++depth > maximum) return true;
    } else if (char === "}" || char === "]") depth -= 1;
  }
  return false;
}
