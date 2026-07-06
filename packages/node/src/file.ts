import { stat } from "node:fs/promises";
import type { ConfigIssue } from "@universal-config-engine/core";

export const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;

export interface FileReadPolicy {
  readonly maxFileBytes?: number;
  readonly encoding?: BufferEncoding;
}

export async function checkFileSize(input: {
  readonly filePath: string;
  readonly sourceId: string;
  readonly maxFileBytes?: number;
}): Promise<readonly ConfigIssue[]> {
  const maxFileBytes = input.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const stats = await stat(input.filePath);

  if (stats.size <= maxFileBytes) {
    return [];
  }

  return [
    {
      category: "resource-limit",
      code: "max_file_bytes_exceeded",
      severity: "error",
      sourceId: input.sourceId,
      message: `Source file exceeds the maximum size of ${maxFileBytes} bytes.`,
      details: {
        fileBytes: stats.size,
        maxFileBytes
      }
    }
  ];
}
