export const DEFAULT_MAX_CONCURRENT_FILE_READS = 64;

export interface ConfigFileReadLimiter {
  /** A lease remains active through I/O cleanup. Undefined means capacity is full. */
  tryAcquire(): (() => void) | undefined;
}

export function createConfigFileReadLimiter(maxConcurrent = DEFAULT_MAX_CONCURRENT_FILE_READS): ConfigFileReadLimiter {
  if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent <= 0) {
    throw new RangeError("File read concurrency must be a positive safe integer.");
  }
  let active = 0;
  return {
    tryAcquire() {
      if (active >= maxConcurrent) return undefined;
      active++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active--;
      };
    }
  };
}
