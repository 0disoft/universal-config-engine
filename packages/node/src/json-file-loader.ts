import { readFile } from "node:fs/promises";
import type { ConfigIssue, ConfigSourceDescriptor, LoadedSource } from "@universal-config-engine/core";
import { checkFileSize, DEFAULT_MAX_FILE_BYTES, type FileReadPolicy } from "./file.js";

export interface LoadJsonFileSourceInput extends FileReadPolicy {
  readonly descriptor: ConfigSourceDescriptor;
  readonly filePath: string;
}

export async function loadJsonFileSource(input: LoadJsonFileSourceInput): Promise<LoadedSource> {
  const maxFileBytes = input.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const encoding = input.encoding ?? "utf8";
  const sizeIssues = await checkFileSize({
    filePath: input.filePath,
    sourceId: input.descriptor.id,
    maxFileBytes
  });

  if (sizeIssues.length > 0) {
    return {
      descriptor: input.descriptor,
      value: {},
      issues: sizeIssues
    };
  }

  try {
    const raw = await readFile(input.filePath, encoding);
    return {
      descriptor: input.descriptor,
      value: JSON.parse(raw) as unknown
    };
  } catch (error) {
    return {
      descriptor: input.descriptor,
      value: {},
      issues: [
        {
          category: "parse",
          code: "json_parse_failed",
          severity: "error",
          sourceId: input.descriptor.id,
          message: error instanceof Error ? error.message : "Failed to parse JSON source."
        }
      ]
    };
  }
}
