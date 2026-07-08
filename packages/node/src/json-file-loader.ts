import type { ConfigSourceDescriptor, LoadedSource } from "@0disoft/universal-config-engine-core";
import { DEFAULT_MAX_FILE_BYTES, readTextFileWithinLimit, type FileReadPolicy } from "./file.js";

export interface LoadJsonFileSourceInput extends FileReadPolicy {
  readonly descriptor: ConfigSourceDescriptor;
  readonly filePath: string;
}

export async function loadJsonFileSource(input: LoadJsonFileSourceInput): Promise<LoadedSource> {
  const maxFileBytes = input.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const encoding = input.encoding ?? "utf8";

  try {
    const readResult = await readTextFileWithinLimit({
      filePath: input.filePath,
      sourceId: input.descriptor.id,
      maxFileBytes,
      encoding
    });
    if (!readResult.ok) {
      return {
        descriptor: input.descriptor,
        value: {},
        issues: readResult.issues
      };
    }

    return {
      descriptor: input.descriptor,
      value: JSON.parse(readResult.raw) as unknown
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
