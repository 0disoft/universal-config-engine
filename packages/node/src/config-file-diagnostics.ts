import type { ConfigIssue } from "@0disoft/universal-config-engine-core";
import type { ConfigFileFormat } from "./config-file-loader.js";

type ParseReason = "parse-failed" | "syntax" | "duplicate-key" | "unsupported-tag" | "unsupported-key" |
  "unsupported-alias" | "multiple-documents";
type Position = { readonly line: number; readonly column: number };

/** Never copy parser messages, tokens, codeblocks, paths or arbitrary error codes. */
export function configFileParseDiagnostic(format: ConfigFileFormat, raw: string, error: unknown):
  Pick<ConfigIssue, "category" | "code" | "message" | "details"> {
  const base = { category: "parse" as const, code: "config_file_parse_failed",
    message: "Failed to parse configuration file. Exception details were omitted." };
  if (format !== "yaml" && format !== "toml" && format !== "json5") return base;
  // Ignore accessors and inherited fields; metadata extraction must not execute error getters.
  const field = (key: string): unknown => error instanceof Error ? Object.getOwnPropertyDescriptor(error, key)?.value : undefined;
  const offsets = field("pos");
  // JSON5 reports column zero immediately after consuming an invalid LF in a string.
  const json5Column = field("columnNumber");
  const position = format === "yaml" ? positionAtOffset(raw, Array.isArray(offsets) ? offsets[0] : undefined)
    : format === "toml" ? numericPosition(raw, field("line"), field("column"))
      : numericPosition(raw, field("lineNumber"), json5Column === 0 ? 1 : json5Column);
  const fallback = position !== undefined || (format === "json5" && error instanceof SyntaxError) ? "syntax" : "parse-failed";
  const reason = format === "yaml" ? yamlReason(field("code"), fallback) : fallback;
  return { ...base,
    message: `Failed to parse ${format.toUpperCase()} configuration (${reason})` +
      (position === undefined ? "." : ` at line ${position.line}, column ${position.column}.`) +
      " Exception details were omitted.",
    details: { format, reason, ...position }
  };
}

function yamlReason(code: unknown, fallback: ParseReason): ParseReason {
  switch (code) {
    case "DUPLICATE_KEY": return "duplicate-key";
    case "TAG_RESOLVE_FAILED": return "unsupported-tag";
    case "NON_STRING_KEY": return "unsupported-key";
    case "BAD_ALIAS": case "ALIAS_PROPS": return "unsupported-alias";
    case "MULTIPLE_DOCS": return "multiple-documents";
    default: return fallback;
  }
}

function numericPosition(raw: string, line: unknown, column: unknown): Position | undefined {
  return typeof line === "number" && Number.isSafeInteger(line) && line > 0 &&
    typeof column === "number" && Number.isSafeInteger(column) && column > 0 &&
    line <= raw.length + 1 && column <= raw.length + 1 ? { line, column } : undefined;
}

/** YAML offsets are UTF-16 indices; count LF/CRLF without allocating source slices or a line index. */
function positionAtOffset(raw: string, offset: unknown): Position | undefined {
  if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0 || offset > raw.length) return;
  let line = 1;
  let start = 0;
  for (let index = 0; index < offset; index += 1) {
    if (raw.charCodeAt(index) === 10) { line += 1; start = index + 1; }
  }
  return { line, column: offset - start + 1 };
}
