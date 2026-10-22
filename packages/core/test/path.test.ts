import { describe, expect, it } from "vitest";
import { getConfigValueAtPath, setConfigValueAtPath, type ConfigValue } from "../src/index.js";

describe("typed config path lookup", () => {
  it("reads array elements without consulting inherited indexes", () => {
    let inheritedReads = 0;
    const prototype = Object.create(Array.prototype);
    Object.defineProperty(prototype, 0, { get() { inheritedReads++; return "inherited"; } });
    const values = new Array<string>(1);
    Object.setPrototypeOf(values, prototype);
    expect(getConfigValueAtPath({ values }, ["values", 0])).toBeUndefined();
    expect(inheritedReads).toBe(0);
    expect(getConfigValueAtPath({ values: ["own"] }, ["values", 0])).toBe("own");
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])(
    "rejects numeric array metadata at index %s", index => {
      const values = ["own"];
      Object.defineProperty(values, String(index), { value: "metadata", enumerable: true });
      expect(getConfigValueAtPath({ values }, ["values", index])).toBeUndefined();
      expect(getConfigValueAtPath({ values }, ["values", 0])).toBe("own");
    }
  );
});

describe("object config path writes", () => {
  it.each([{ path: ["service", "nested", 0] }, { path: ["service", "nested", "__proto__"] }])(
    "validates the complete path before replacing ancestors ($path)", ({ path }) => {
      const root = { service: "existing" };
      expect(() => setConfigValueAtPath(root, path, true)).toThrow();
      expect(root).toEqual({ service: "existing" });
    }
  );

  it("clones the new value before replacing ancestors", () => {
    const root = { service: "existing" };
    const cyclic: Record<string, ConfigValue> = {};
    cyclic.self = cyclic;
    expect(() => setConfigValueAtPath(root, ["service", "nested"], cyclic)).toThrow(/Cyclic/);
    expect(root).toEqual({ service: "existing" });
    const unsafe = JSON.parse('{"nested":{"constructor":1}}') as ConfigValue;
    expect(() => setConfigValueAtPath(root, ["service", "nested"], unsafe)).toThrow(/Unsafe/);
    expect(root).toEqual({ service: "existing" });
  });

  it("owns a replacement value that contains a reference to the destination", () => {
    const root: Record<string, ConfigValue> = { service: "existing" };
    const replacement = { previous: root };
    setConfigValueAtPath(root, ["service", "nested"], replacement);
    expect(root).toEqual({ service: { nested: { previous: { service: "existing" } } } });
    expect(getConfigValueAtPath(root, ["service", "nested", "previous"])).not.toBe(root);
  });
});
