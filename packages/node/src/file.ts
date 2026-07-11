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
  | { readonly ok: true; readonly raw: string }
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
    const boundaryIssues = await openedFileBoundaryIssues({
      filePath: input.filePath,
      sourceId: input.sourceId,
      allowedRootPath: input.allowedRootPath,
      openedDevice: stats.dev,
      openedInode: stats.ino
    });
    if (boundaryIssues.length > 0) {
      return {
        ok: false,
        issues: boundaryIssues
      };
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
      ? raw
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

async function openedFileBoundaryIssues(input: {
  readonly filePath: string;
  readonly sourceId: string;
  readonly allowedRootPath: string | undefined;
  readonly openedDevice: number;
  readonly openedInode: number;
}): Promise<readonly ConfigIssue[]> {
  if (input.allowedRootPath === undefined) {
    return [];
  }

  try {
    const [canonicalRootPath, canonicalFilePath] = await Promise.all([
      realpath(input.allowedRootPath),
      realpath(input.filePath)
    ]);
    if (!isInsideOrEqualPath(canonicalRootPath, canonicalFilePath)) {
      return [fileBoundaryIssue(input.sourceId, "file_path_outside_allowed_root")];
    }

    const currentStats = await stat(canonicalFilePath);
    if (currentStats.dev !== input.openedDevice || currentStats.ino !== input.openedInode) {
      return [fileBoundaryIssue(input.sourceId, "file_identity_changed")];
    }

    return [];
  } catch {
    return [fileBoundaryIssue(input.sourceId, "file_boundary_verification_failed")];
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
