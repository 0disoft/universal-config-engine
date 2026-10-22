import { open, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import type { ConfigIssue, ConfigOperationOptions, ConfigAbortSignal } from "@0disoft/universal-config-engine-core";
import { positiveSafeIntegerLimit } from "./limits.js";

export const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;

export interface ConfigFileStats { readonly dev: bigint; readonly ino: bigint; readonly size: bigint; }
export interface ConfigFileHandle {
  stat(options: { bigint: true }): Promise<ConfigFileStats>;
  read(buffer: Buffer, offset: number, length: number, position: null): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}
export interface ConfigFileSystem {
  open(path: string, flags: "r"): Promise<ConfigFileHandle>;
  realpath(path: string): Promise<string>;
  stat(path: string, options: { bigint: true }): Promise<ConfigFileStats>;
}
const nativeFileSystem: ConfigFileSystem = { open, realpath, stat };

export interface FileReadPolicy extends ConfigOperationOptions {
  /** Optional I/O boundary for deterministic tests; defaults to Node filesystem. */
  readonly fileSystem?: ConfigFileSystem;
  readonly maxFileBytes?: number;
  readonly encoding?: BufferEncoding;
  readonly allowedRootPath?: string;
}

export type BoundedTextFileReadResult =
  | { readonly ok: true; readonly raw: string; readonly canonicalPath: string }
  | { readonly ok: false; readonly issues: readonly ConfigIssue[] };

export async function readTextFileWithinLimit(input: FileReadPolicy & {
  readonly filePath: string;
  readonly sourceId: string;
}): Promise<BoundedTextFileReadResult> {
  const maxFileBytes = positiveSafeIntegerLimit(input.maxFileBytes, DEFAULT_MAX_FILE_BYTES);
  const encoding = input.encoding ?? "utf8";
  const fileSystem = input.fileSystem ?? nativeFileSystem;
  if (input.signal?.aborted) return { ok: false, issues: [fileAbortedIssue(input.sourceId)] };
  const fileHandle = await fileSystem.open(input.filePath, "r");
  let completedSuccessfully = false;
  try {
    assertFileActive(input.signal);
    const stats = await fileHandle.stat({ bigint: true });
    const boundaryResult = await openedFileBoundaryResult({
      filePath: input.filePath,
      sourceId: input.sourceId,
      allowedRootPath: input.allowedRootPath,
      openedDevice: stats.dev,
      openedInode: stats.ino
    }, fileSystem);
    assertFileActive(input.signal);
    if (!boundaryResult.ok) {
      return boundaryResult;
    }

    const sizeIssues = fileSizeIssues({
      sourceId: input.sourceId,
      fileBytes: Number(stats.size),
      maxFileBytes
    });

    if (sizeIssues.length > 0) {
      return {
        ok: false,
        issues: sizeIssues
      };
    }

    const raw = await readFileHandleWithinLimit(fileHandle, maxFileBytes, encoding, input.signal);
    completedSuccessfully = raw.ok;
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
  } catch (error) {
    if (error instanceof FileReadAborted) return { ok: false, issues: [fileAbortedIssue(input.sourceId)] };
    throw error;
  } finally {
    try { await fileHandle.close(); }
    catch (error) { if (completedSuccessfully) throw error; }
  }
}

async function openedFileBoundaryResult(input: {
  readonly filePath: string;
  readonly sourceId: string;
  readonly allowedRootPath: string | undefined;
  readonly openedDevice: bigint;
  readonly openedInode: bigint;
}, fileSystem: ConfigFileSystem): Promise<
  | { readonly ok: true; readonly canonicalPath: string }
  | { readonly ok: false; readonly issues: readonly ConfigIssue[] }
> {
  try {
    const canonicalFilePath = await fileSystem.realpath(input.filePath);
    const currentStats = await fileSystem.stat(canonicalFilePath, { bigint: true });
    if (!sameFileIdentity({
      openedDevice: input.openedDevice,
      openedInode: input.openedInode,
      currentDevice: currentStats.dev,
      currentInode: currentStats.ino
    })) {
      return {
        ok: false,
        issues: [fileBoundaryIssue(input.sourceId, "file_identity_changed")]
      };
    }

    if (input.allowedRootPath !== undefined) {
      const canonicalRootPath = await fileSystem.realpath(input.allowedRootPath);
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

function sameFileIdentity(input: {
  readonly openedDevice: bigint;
  readonly openedInode: bigint;
  readonly currentDevice: bigint;
  readonly currentInode: bigint;
}): boolean {
  if (input.openedInode !== input.currentInode) {
    return false;
  }
  if (input.openedDevice === 0n || input.currentDevice === 0n) {
    return true;
  }
  return input.openedDevice === input.currentDevice;
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
  fileHandle: ConfigFileHandle,
  maxFileBytes: number,
  encoding: BufferEncoding,
  signal?: ConfigAbortSignal
): Promise<{ readonly ok: true; readonly raw: string } | { readonly ok: false; readonly fileBytes: number }> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for (;;) {
    assertFileActive(signal);
    const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
    const { bytesRead } = await fileHandle.read(buffer, 0, buffer.length, null);
    assertFileActive(signal);
    if (bytesRead === 0) {
      return {
        ok: true,
        raw: decodeFileBytes(Buffer.concat(chunks, totalBytes), encoding)
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

/** Keep BOM handling unchanged while refusing lossy UTF-8 replacement. */
function decodeFileBytes(bytes: Buffer, encoding: BufferEncoding): string {
  return encoding === "utf8" || encoding === "utf-8"
    ? new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)
    : bytes.toString(encoding);
}

class FileReadAborted extends Error {}
function assertFileActive(signal?: ConfigAbortSignal): void {
  if (signal?.aborted) throw new FileReadAborted();
}
function fileAbortedIssue(sourceId: string): ConfigIssue {
  return { category: "source-load", code: "operation_aborted", severity: "error", sourceId,
    message: "Configuration file reading was cancelled." };
}
