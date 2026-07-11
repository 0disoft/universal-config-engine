import type { ConfigSourceDescriptor, LoadedSource } from "@0disoft/universal-config-engine-core";
import { DEFAULT_MAX_FILE_BYTES, readTextFileWithinLimit, type FileReadPolicy } from "./file.js";

export interface LoadJsonFileSourceInput extends FileReadPolicy {
  readonly descriptor: ConfigSourceDescriptor;
  readonly filePath: string;
}

export async function loadJsonFileSource(input: LoadJsonFileSourceInput): Promise<LoadedSource> {
  const maxFileBytes = input.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const encoding = input.encoding ?? "utf8";
  let readResult: Awaited<ReturnType<typeof readTextFileWithinLimit>>;

  try {
    readResult = await readTextFileWithinLimit({
      filePath: input.filePath,
      sourceId: input.descriptor.id,
      maxFileBytes,
      encoding,
      ...(input.allowedRootPath === undefined ? {} : { allowedRootPath: input.allowedRootPath })
    });
  } catch {
    return {
      descriptor: input.descriptor,
      value: {},
      issues: [
        {
          category: "source-load",
          code: "json_read_failed",
          severity: "error",
          sourceId: input.descriptor.id,
          message: "Failed to read JSON source. Exception details were omitted from diagnostics."
        }
      ]
    };
  }

  if (!readResult.ok) {
    return {
      descriptor: input.descriptor,
      value: {},
      issues: readResult.issues
    };
  }

  try {
    return {
      descriptor: input.descriptor,
      value: JSON.parse(readResult.raw) as unknown
    };
  } catch {
    return {
      descriptor: input.descriptor,
      value: {},
      issues: [
        {
          category: "parse",
          code: "json_parse_failed",
          severity: "error",
          sourceId: input.descriptor.id,
          message: "Failed to parse JSON source. Exception details were omitted from diagnostics."
        }
      ]
    };
  }
}
