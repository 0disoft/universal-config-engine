import { describe, expect, it } from "vitest";
import { createMappedOverrideSource, resolveConfig } from "../src/index.js";

describe("mapping input ownership", () => {
  const descriptor = { id: "argv", kind: "argv" as const, priority: 1, displayName: "argv" };

  it.each(["toString", "constructor", "__proto__", "hasOwnProperty"])("maps only an explicitly supplied %s", (externalName) => {
    const mappings = [{ externalName, sourceKind: "argv" as const, targetPath: ["port"], parseAs: "number" as const }];
    const missing = createMappedOverrideSource({ descriptor, values: {}, mappings });
    expect(missing.value).toEqual({});
    expect(missing.issues).toEqual([]);
    expect(resolveConfig({ sources: [missing] }).ok).toBe(true);

    const supplied = createMappedOverrideSource({ descriptor, values: { [externalName]: "9000" }, mappings });
    expect(supplied.value).toEqual({ port: 9000 });
    expect(supplied.issues).toEqual([]);
  });

  it("ignores inherited input without invoking its getter", () => {
    const values = Object.create({
      get PORT(): string {
        throw new Error("An inherited value must not be inspected.");
      }
    }) as Record<string, string>;
    const result = createMappedOverrideSource({
      descriptor,
      values,
      mappings: [{ externalName: "PORT", sourceKind: "argv", targetPath: ["port"] }]
    });
    expect(result.value).toEqual({});
    expect(result.issues).toEqual([]);
  });
});
