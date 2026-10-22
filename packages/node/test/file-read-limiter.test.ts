import { describe, expect, it, vi } from "vitest";
import {
  createConfigFileReadLimiter, loadJsonFileSource, readTextFileWithinLimit,
  type ConfigFileSystem
} from "../src/index.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}
const input = { filePath: "/workspace/config.json", sourceId: "test" };
const descriptor = { id: "test", kind: "json-file" as const, priority: 0, displayName: "test" };

function fixture() {
  const started = deferred<void>(), reading = deferred<{ bytesRead: number }>();
  const closing = deferred<void>(), closed = deferred<void>();
  const stats = { dev: 1n, ino: 1n, size: 0n };
  const handle = { stat: vi.fn(async () => stats),
    read: vi.fn(() => { started.resolve(); return reading.promise; }),
    close: vi.fn(() => { closing.resolve(); return closed.promise; }) };
  const fileSystem = { open: vi.fn(async () => handle), realpath: vi.fn(async (path: string) => path),
    stat: vi.fn(async () => stats) } satisfies ConfigFileSystem;
  return { started, reading, closing, closed, handle, fileSystem };
}

describe("file I/O admission", () => {
  it("retains capacity through cancellation and pending cleanup, without queueing more opens", async () => {
    const readLimiter = createConfigFileReadLimiter(1), controller = new AbortController();
    const runtime = fixture();
    const pending = readTextFileWithinLimit({ ...input, readLimiter, fileSystem: runtime.fileSystem, signal: controller.signal });
    try {
      await runtime.started.promise;
      controller.abort();
      const rejected = await loadJsonFileSource({ ...input, descriptor, readLimiter, fileSystem: runtime.fileSystem });
      expect(rejected.issues?.[0]?.code).toBe("max_concurrent_file_reads_exceeded");
      expect(runtime.fileSystem.open).toHaveBeenCalledTimes(1);
      runtime.reading.resolve({ bytesRead: 0 }); await runtime.closing.promise;
      expect(readLimiter.tryAcquire()).toBeUndefined();
      runtime.closed.resolve();
      expect(await pending).toMatchObject({ ok: false, issues: [{ code: "operation_aborted" }] });
      const release = readLimiter.tryAcquire();
      expect(release).toBeTypeOf("function"); release!();
    } finally { runtime.reading.resolve({ bytesRead: 0 }); runtime.closed.resolve(); await pending; }
  });

  it("forwards cancellation to cooperative I/O and releases the lease after close", async () => {
    const readLimiter = createConfigFileReadLimiter(1), controller = new AbortController();
    const started = deferred<void>();
    const stats = { dev: 1n, ino: 1n, size: 0n };
    const seen: unknown[] = [];
    const close = vi.fn(async () => {});
    const fileSystem: ConfigFileSystem = { ...fixture().fileSystem, withSignal(signal) {
      const bound: ConfigFileSystem = {
      async open() {
        seen.push(signal);
        return {
          async stat() { seen.push(signal); return stats; }, close,
          read() {
            seen.push(signal); started.resolve();
            return new Promise((_resolve, reject) => {
              signal.addEventListener("abort", () => reject(new Error("cancelled I/O")), { once: true });
            });
          }
        };
      },
      async realpath(path) { seen.push(signal); return path; },
      async stat() { seen.push(signal); return stats; }
      };
      return bound;
    } };
    const pending = loadJsonFileSource({ ...input, descriptor, readLimiter, fileSystem, signal: controller.signal });
    await started.promise; controller.abort();
    expect((await pending).issues?.[0]?.code).toBe("operation_aborted");
    expect(seen).toHaveLength(5); expect(seen.every(signal => signal === controller.signal)).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
    const release = readLimiter.tryAcquire(); expect(release).toBeTypeOf("function"); release!();
  });

  it("releases capacity when opening fails, but reserves it when cleanup is unconfirmed", async () => {
    const readLimiter = createConfigFileReadLimiter(1), runtime = fixture();
    runtime.fileSystem.open.mockRejectedValueOnce(new Error("open failed"));
    await expect(readTextFileWithinLimit({ ...input, readLimiter, fileSystem: runtime.fileSystem })).rejects.toThrow("open failed");
    runtime.reading.resolve({ bytesRead: 0 });
    runtime.handle.close.mockRejectedValueOnce(new Error("close failed"));
    await expect(readTextFileWithinLimit({ ...input, readLimiter, fileSystem: runtime.fileSystem })).rejects.toThrow("close failed");
    expect(readLimiter.tryAcquire()).toBeUndefined();
  });

  it("enforces exact capacity and makes lease release idempotent", () => {
    const limiter = createConfigFileReadLimiter(2);
    const first = limiter.tryAcquire()!, second = limiter.tryAcquire()!;
    expect(limiter.tryAcquire()).toBeUndefined(); first(); first();
    const replacement = limiter.tryAcquire()!;
    expect(limiter.tryAcquire()).toBeUndefined(); second(); replacement();
  });

  it.each([0, -1, 1.5, NaN, Infinity])("rejects invalid admission capacity %s", maximum => {
    expect(() => createConfigFileReadLimiter(maximum)).toThrow(RangeError);
  });
});
