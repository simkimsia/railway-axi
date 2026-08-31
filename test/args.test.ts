import { describe, expect, it } from "vitest";
import { assertNoArgs } from "../src/args.js";
import { AxiError } from "../src/errors.js";

describe("assertNoArgs", () => {
  it("accepts an empty argv", () => {
    expect(() => assertNoArgs("list", [])).not.toThrow();
  });

  it("rejects unknown flags by name with a VALIDATION_ERROR", () => {
    try {
      assertNoArgs("list", ["--stat"]);
      expect.unreachable("should have thrown");
    } catch (error) {
      const axiError = error as AxiError;
      expect(axiError.code).toBe("VALIDATION_ERROR");
      expect(axiError.message).toContain("--stat");
      expect(axiError.message).toContain("list");
    }
  });

  it("rejects stray positional arguments", () => {
    expect(() => assertNoArgs("whoami", ["extra"])).toThrow(/unknown argument/);
  });
});
