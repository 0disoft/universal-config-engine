import { describe, expect, it, vi } from "vitest";
import { loadJsonFileSource, readTextFileWithinLimit, type ConfigFileSystem } from "../src/index.js";

function fixture(content = "{}") {
  const bytes = Buffer.from(content);
  let position = 0;
  const stats = { dev: 1n, ino: 1n, size: BigInt(bytes.length) };
  const handle = { stat: vi.fn(async () => stats), close: vi.fn(async () => {}),
    read: vi.fn(async (buffer: Buffer) => {
      const count = bytes.copy(buffer, 0, position); position += count;
      return { bytesRead: count };
    }) };
  const fileSystem = { open: vi.fn(async () => handle), realpath: vi.fn(async (path: string) => path),
    stat: vi.fn(async () => stats) } satisfies ConfigFileSystem;
  return { handle, fileSystem, stats };
}
const input = { sourceId: "test", filePath: "/workspace/config.json" };

describe("injected file I/O boundary", () => {
  it.each([1, 2, 3])("enforces byte counts immediately around limit 2 (%s bytes)", async count => {
    const { handle, fileSystem } = fixture("x".repeat(count));
    const result = await readTextFileWithinLimit({ ...input, maxFileBytes: 2, fileSystem });
    expect(result.ok).toBe(count <= 2);
    expect(handle.close).toHaveBeenCalledTimes(1);
    if (count > 2) expect(handle.read).not.toHaveBeenCalled();
  });

  it("rejects growth after the initial stat before parsing", async () => {
    const { handle, fileSystem, stats } = fixture("123");
    stats.size = 1n;
    const result = await readTextFileWithinLimit({ ...input, maxFileBytes: 2, fileSystem });
    expect(result).toMatchObject({ ok: false, issues: [{ code: "max_file_bytes_exceeded" }] });
    expect(handle.close).toHaveBeenCalledTimes(1);
  });

  it("skips open when cancelled and closes once when cancelled during reading", async () => {
    const controller = new AbortController();
    const { handle, fileSystem } = fixture();
    handle.read.mockImplementationOnce(async () => { controller.abort(); return { bytesRead: 0 }; });
    const loaded = await loadJsonFileSource({ filePath: input.filePath, fileSystem, signal: controller.signal,
      descriptor: { id: "test", kind: "json-file", priority: 0, displayName: "test" } });
    expect(loaded.value).toEqual({});
    expect(loaded.issues).toEqual([expect.objectContaining({ code: "operation_aborted" })]);
    expect(handle.close).toHaveBeenCalledTimes(1);
    fileSystem.open.mockClear();
    expect((await readTextFileWithinLimit({ ...input, fileSystem, signal: controller.signal })).ok).toBe(false);
    expect(fileSystem.open).not.toHaveBeenCalled();
  });

  it.each(["stat", "read"] as const)("preserves the primary %s exception when cleanup also fails", async stage => {
    const { handle, fileSystem } = fixture();
    const primary = new Error("primary operation failure");
    handle[stage].mockRejectedValueOnce(primary);
    handle.close.mockRejectedValueOnce(new Error("cleanup failure"));
    await expect(readTextFileWithinLimit({ ...input, fileSystem })).rejects.toBe(primary);
    expect(handle.close).toHaveBeenCalledTimes(1);
  });

  it("reports cleanup failure after a successful read", async () => {
    const { handle, fileSystem } = fixture();
    handle.close.mockRejectedValueOnce(new Error("cleanup failure"));
    await expect(readTextFileWithinLimit({ ...input, fileSystem })).rejects.toThrow("cleanup failure");
  });
});
