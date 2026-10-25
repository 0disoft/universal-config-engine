import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function withTempDir<T>(callback: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "uce-cli-"));
  try {
    return await callback(await realpath(dir));
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}
