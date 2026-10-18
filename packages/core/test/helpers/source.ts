import type { LoadedSource } from "../../src/index.js";

export function source(id: string, priority: number, value: unknown): LoadedSource {
  return {
    descriptor: {
      id,
      kind: "object",
      priority,
      displayName: id
    },
    value
  };
}
