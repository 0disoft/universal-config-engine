import { expect, it } from "vitest";
import fc from "fast-check";
import { PathIntersectionIndex } from "../src/path-intersection-index.js";
import { isPathPrefix } from "../src/path.js";

it("matches typed prefix scans for roots, duplicate paths, ancestors and descendants", () => {
  const path = fc.array(fc.constantFrom<string | number>("a", "b", "a.b", "0", 0, 1), { maxLength: 5 });
  fc.assert(fc.property(fc.array(path, { maxLength: 30 }), path, (paths, query) => {
    const entries = paths.map((path, id) => ({ path, id }));
    const index = new PathIntersectionIndex(entries, entry => entry.path);
    const expected = entries.filter(entry => isPathPrefix(entry.path, query) || isPathPrefix(query, entry.path));
    expect(index.intersects(query)).toBe(expected.length > 0);
    expect(index.related(query).map(entry => entry.id).sort((a, b) => a - b)).toEqual(expected.map(entry => entry.id));
  }), { numRuns: 200 });
});
