import { open, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import type { ConfigIssue } from "@0disoft/universal-config-engine-core";
import { positiveSafeIntegerLimit } from "./limits.js";

export const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;

export interface FileReadPolicy {
  readonly maxFileBytes?: number;
  readonly encoding?: BufferEncoding;
  readonly allowedRootPath?: string;
}

export type BoundedTextFileReadResult =
  | { readonly ok: true; readonly raw: string; readonly canonicalPath: string }
  | { readonly ok: false; readonly issues: readonly ConfigIssue[] };

export async function readTextFileWithinLimit(input: {
  readonly filePath: string;
  readonly sourceId: string;
  readonly maxFileBytes?: number;
  readonly encoding?: BufferEncoding;
  readonly allowedRootPath?: string;
}): Promise<BoundedTextFileReadResult> {
  const maxFileBytes = positiveSafeIntegerLimit(input.maxFileBytes, DEFAULT_MAX_FILE_BYTES);
  const encoding = input.encoding ?? "utf8";
  const fileHandle = await open(input.filePath, "r");

  try {
    const stats = await fileHandle.stat();
    const boundaryResult = await openedFileBoundaryResult({
      filePath: input.filePath,
      sourceId: input.sourceId,
      allowedRootPath: input.allowedRootPath,
      openedDevice: stats.dev,
      openedInode: stats.ino
    });
    if (!boundaryResult.ok) {
      return boundaryResult;
    }

    const sizeIssues = fileSizeIssues({
      sourceId: input.sourceId,
      fileBytes: stats.size,
      maxFileBytes
    });

    if (sizeIssues.length > 0) {
      return {
        ok: false,
        issues: sizeIssues
      };
    }

    const raw = await readFileHandleWithinLimit(fileHandle, maxFileBytes, encoding);
    return raw.ok
      ? { ...raw, canonicalPath: boundaryResult.canonicalPath }
      : {
          ok: false,
          issues: fileSizeIssues({
            sourceId: input.sourceId,
            fileBytes: raw.fileBytes,
            maxFileBytes
          })
        };
  } finally {
    await fileHandle.close();
  }
}

async function openedFileBoundaryResult(input: {
  readonly filePath: string;
  readonly sourceId: string;
  readonly allowedRootPath: string | undefined;
  readonly openedDevice: number;
  readonly openedInode: number;
}): Promise<
  | { readonly ok: true; readonly canonicalPath: string }
  | { readonly ok: false; readonly issues: readonly ConfigIssue[] }
> {
  try {
    const canonicalFilePath = await realpath(input.filePath);
    const currentStats = await stat(canonicalFilePath);
    if (currentStats.dev !== input.openedDevice || currentStats.ino !== input.openedInode) {
      return {
        ok: false,
        issues: [fileBoundaryIssue(input.sourceId, "file_identity_changed")]
      };
    }

    if (input.allowedRootPath !== undefined) {
      const canonicalRootPath = await realpath(input.allowedRootPath);
      if (!isInsideOrEqualPath(canonicalRootPath, canonicalFilePath)) {
        return {
          ok: false,
          issues: [fileBoundaryIssue(input.sourceId, "file_path_outside_allowed_root")]
        };
      }
    }

    return { ok: true, canonicalPath: canonicalFilePath };
  } catch {
    return {
      ok: false,
      issues: [fileBoundaryIssue(input.sourceId, "file_boundary_verification_failed")]
    };
  }
}

function isInsideOrEqualPath(rootPath: string, targetPath: string): boolean {
  const relativePath = relative(rootPath, targetPath);
  return (
    relativePath === "" ||
    (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
  );
}

function fileBoundaryIssue(sourceId: string, code: string): ConfigIssue {
  return {
    category: "source-load",
    code,
    severity: "error",
    sourceId,
    message: "File source boundary verification failed before reading contents."
  };
}

export async function checkFileSize(input: {
  readonly filePath: string;
  readonly sourceId: string;
  readonly maxFileBytes?: number;
}): Promise<readonly ConfigIssue[]> {
  const maxFileBytes = positiveSafeIntegerLimit(input.maxFileBytes, DEFAULT_MAX_FILE_BYTES);
  const stats = await stat(input.filePath);
  return fileSizeIssues({
    sourceId: input.sourceId,
    fileBytes: stats.size,
    maxFileBytes
  });
}

function fileSizeIssues(input: {
  readonly sourceId: string;
  readonly fileBytes: number;
  readonly maxFileBytes: number;
}): readonly ConfigIssue[] {
  if (input.fileBytes <= input.maxFileBytes) {
    return [];
  }

  return [
    {
      category: "resource-limit",
      code: "max_file_bytes_exceeded",
      severity: "error",
      sourceId: input.sourceId,
      message: `Source file exceeds the maximum size of ${input.maxFileBytes} bytes.`,
      details: {
        fileBytes: input.fileBytes,
        maxFileBytes: input.maxFileBytes
      }
    }
  ];
}

async function readFileHandleWithinLimit(
  fileHandle: Awaited<ReturnType<typeof open>>,
  maxFileBytes: number,
  encoding: BufferEncoding
): Promise<{ readonly ok: true; readonly raw: string } | { readonly ok: false; readonly fileBytes: number }> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for (;;) {
    const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
    const { bytesRead } = await fileHandle.read(buffer, 0, buffer.length, null);
    if (bytesRead === 0) {
      return {
        ok: true,
        raw: Buffer.concat(chunks, totalBytes).toString(encoding)
      };
    }

    totalBytes += bytesRead;
    if (totalBytes > maxFileBytes) {
      return {
        ok: false,
        fileBytes: totalBytes
      };
    }

    chunks.push(buffer.subarray(0, bytesRead));
  }
}
