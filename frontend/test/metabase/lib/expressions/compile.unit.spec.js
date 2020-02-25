// import { compile } from "metabase/lib/expressions/compile";

import {
  shared,
  aggregationOpts,
  expressionOpts,
} from "./__support__/expressions";

describe("metabase/lib/expressions/compile", () => {
  let compile;
  it("should load compile within 3 seconds", () => {
    const start = Date.now();
    compile = require("metabase/lib/expressions/compile").compile;
    const end = Date.now();
    expect(end - start).toBeLessThan(3000);
  });

  describe("compile()", () => {
    for (const [name, cases, opts] of shared) {
      describe(name, () => {
        for (const [source, mbql, description] of cases) {
          if (mbql) {
            it(`should compile ${description}`, () => {
              const start = Date.now();
              expect(compile(source, opts)).toEqual(mbql);
              const elapsed = Date.now() - start;
              expect(elapsed).toBeLessThan(500);
            });
          } else {
            it(`should not compile ${description}`, () => {
              const start = Date.now();
              expect(() => compile(source, opts)).toThrow();
              const elapsed = Date.now() - start;
              expect(elapsed).toBeLessThan(500);
            });
          }
        }
      });
    }

    // NOTE: only add tests below for things that don't fit the shared test cases above

    it("should return empty array for null or empty string", () => {
      expect(compile()).toEqual([]);
      expect(compile(null)).toEqual([]);
      expect(compile("")).toEqual([]);
    });

    it("should throw exception on invalid input", () => {
      expect(() => compile("1 + ", expressionOpts)).toThrow();
    });

    it("should treat aggregations as case-insensitive", () => {
      expect(compile("count", aggregationOpts)).toEqual(["count"]);
      expect(compile("cOuNt", aggregationOpts)).toEqual(["count"]);
      expect(compile("average(A)", aggregationOpts)).toEqual([
        "avg",
        ["field-id", 1],
      ]);
    });

    it("should fail to compile within 250ms", () => {
      const start = Date.now();
      try {
        compile("Share((");
        expect(true).toBe(false);
      } catch (e) {
        const end = Date.now();
        expect(end - start).toBeLessThan(250);
      }
    });
  });
});
