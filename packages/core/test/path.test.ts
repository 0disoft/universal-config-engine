import { describe, expect, it } from "vitest";
import { getConfigValueAtPath } from "../src/index.js";

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
