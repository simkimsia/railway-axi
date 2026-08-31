import { describe, expect, it } from "vitest";
import { exitCodeForError, mapRailwayError } from "../src/errors.js";

describe("mapRailwayError", () => {
  it("maps auth failures to AUTH with a login suggestion", () => {
    const err = mapRailwayError("Unauthorized. Please login with `railway login`", 1);
    expect(err.code).toBe("AUTH");
    expect(err.suggestions.join(" ")).toContain("railway login");
    expect(exitCodeForError(err)).toBe(1);
  });

  it("maps unlinked directories to NOT_LINKED with a link suggestion", () => {
    const err = mapRailwayError("No linked project found. Run railway link to connect to a project", 1);
    expect(err.code).toBe("NOT_LINKED");
    expect(err.suggestions.join(" ")).toContain("railway link");
  });

  it("falls back to UNKNOWN with the first stderr line", () => {
    const err = mapRailwayError("Something exploded\nstack trace line", 1);
    expect(err.code).toBe("UNKNOWN");
    expect(err.message).toBe("Something exploded");
  });

  it("reports the exit code when stderr is empty", () => {
    const err = mapRailwayError("", 3);
    expect(err.message).toBe("railway exited with code 3");
  });
});
