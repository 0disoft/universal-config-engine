import { reportConfigOperationError, type ConfigIssue, type ConfigSourceDescriptor, type LoadedSource } from "@0disoft/universal-config-engine-core";
import { DEFAULT_MAX_FILE_BYTES, readTextFileWithinLimit, type FileReadPolicy } from "./file.js";

interface FileSourceInput extends FileReadPolicy {
  readonly descriptor: ConfigSourceDescriptor;
  readonly filePath: string;
}

type FailureDiagnostic = Pick<ConfigIssue, "category" | "code" | "message">;

interface FileSourceOptions {
  readonly readFailure: FailureDiagnostic;
  readonly parseFailure?: FailureDiagnostic;
  readonly parse: (raw: string, canonicalPath: string) => LoadedSource | Promise<LoadedSource>;
}

/** Shared I/O boundary; format-specific parsing and diagnostic codes stay with the adapter. */
export async function loadTextFileSource(input: FileSourceInput, options: FileSourceOptions): Promise<LoadedSource> {
  let readResult: Awaited<ReturnType<typeof readTextFileWithinLimit>>;
  try {
    readResult = await readTextFileWithinLimit({
      filePath: input.filePath,
      sourceId: input.descriptor.id,
      maxFileBytes: input.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
      encoding: input.encoding ?? "utf8",
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      ...(input.onError === undefined ? {} : { onError: input.onError }),
      ...(input.fileSystem === undefined ? {} : { fileSystem: input.fileSystem }),
      ...(input.readLimiter === undefined ? {} : { readLimiter: input.readLimiter }),
      ...(input.allowedRootPath === undefined ? {} : { allowedRootPath: input.allowedRootPath })
    });
  } catch (error) {
    reportConfigOperationError(input, options.readFailure.code, error, input.descriptor.id);
    return input.signal?.aborted ? cancelledSource(input.descriptor) : failureSource(input.descriptor, options.readFailure);
  }
  if (!readResult.ok) {
    return { descriptor: input.descriptor, value: {}, issues: readResult.issues };
  }
  if (input.signal?.aborted) return cancelledSource(input.descriptor);
  try {
    const parsed = await options.parse(readResult.raw, readResult.canonicalPath);
    return input.signal?.aborted ? cancelledSource(input.descriptor) : parsed;
  } catch (error) {
    reportConfigOperationError(input, (options.parseFailure ?? options.readFailure).code, error, input.descriptor.id);
    return input.signal?.aborted ? cancelledSource(input.descriptor)
      : failureSource(input.descriptor, options.parseFailure ?? options.readFailure);
  }
}

function failureSource(descriptor: ConfigSourceDescriptor, diagnostic: FailureDiagnostic): LoadedSource {
  return {
    descriptor,
    value: {},
    issues: [{
      category: diagnostic.category,
      code: diagnostic.code,
      severity: "error",
      sourceId: descriptor.id,
      message: diagnostic.message
    }]
  };
}

function cancelledSource(descriptor: ConfigSourceDescriptor): LoadedSource {
  return failureSource(descriptor, { category: "source-load", code: "operation_aborted",
    message: "Configuration file loading was cancelled." });
}
