import { describe, expect, it } from "vitest";
import {
  assertNoArgs,
  takeBoolFlag,
  takeFlag,
  takeIntFlag,
  takePositional,
} from "../src/args.js";
import { AxiError } from "../src/errors.js";

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as AxiError).code;
  }
  return "no-throw";
}

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

describe("takeFlag", () => {
  it("takes the space form and removes both tokens", () => {
    const args = ["--service", "web", "--limit", "5"];
    expect(takeFlag(args, "--service")).toBe("web");
    expect(args).toEqual(["--limit", "5"]);
  });

  it("takes the equals form", () => {
    const args = ["--service=web"];
    expect(takeFlag(args, "--service")).toBe("web");
    expect(args).toEqual([]);
  });

  it("returns undefined and leaves args alone when absent", () => {
    const args = ["--limit", "5"];
    expect(takeFlag(args, "--service")).toBeUndefined();
    expect(args).toEqual(["--limit", "5"]);
  });

  it("refuses to consume another option as the value", () => {
    const args = ["--service", "--limit", "5"];
    expect(codeOf(() => takeFlag(args, "--service"))).toBe("VALIDATION_ERROR");
    expect(args).toEqual(["--service", "--limit", "5"]);
  });

  it("refuses a trailing flag with no value", () => {
    expect(codeOf(() => takeFlag(["--service"], "--service"))).toBe(
      "VALIDATION_ERROR",
    );
  });

  it("accepts a dash-leading value through the equals form", () => {
    expect(takeFlag(["--filter=-weird"], "--filter")).toBe("-weird");
  });
});

describe("takeBoolFlag", () => {
  it("reports presence and removes the token", () => {
    const args = ["--build", "abc"];
    expect(takeBoolFlag(args, "--build")).toBe(true);
    expect(args).toEqual(["abc"]);
    expect(takeBoolFlag(args, "--build")).toBe(false);
  });
});

describe("takeIntFlag", () => {
  it("defaults when absent", () => {
    expect(takeIntFlag([], "--limit", 20, 100)).toBe(20);
  });

  it("parses and clamps to the maximum", () => {
    expect(takeIntFlag(["--limit", "7"], "--limit", 20, 100)).toBe(7);
    expect(takeIntFlag(["--limit=1000"], "--limit", 20, 100)).toBe(100);
  });

  it("rejects non-integers and zero", () => {
    expect(
      codeOf(() => takeIntFlag(["--limit", "many"], "--limit", 20, 100)),
    ).toBe("VALIDATION_ERROR");
    expect(
      codeOf(() => takeIntFlag(["--limit", "0"], "--limit", 20, 100)),
    ).toBe("VALIDATION_ERROR");
  });
});

describe("takePositional", () => {
  it("takes the first non-option token", () => {
    const args = ["--build", "dep-123", "--lines", "5"];
    expect(takePositional(args)).toBe("dep-123");
    expect(args).toEqual(["--build", "--lines", "5"]);
  });

  it("returns undefined when there is none", () => {
    expect(takePositional(["--build"])).toBeUndefined();
  });
});
