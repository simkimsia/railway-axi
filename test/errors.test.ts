import { describe, expect, it } from "vitest";
import { exitCodeForError, mapRailwayError } from "../src/errors.js";

describe("mapRailwayError", () => {
  it("maps auth failures to AUTH with a login suggestion", () => {
    const err = mapRailwayError(
      "Unauthorized. Please login with `railway login`",
      1,
    );
    expect(err.code).toBe("AUTH");
    expect(err.suggestions.join(" ")).toContain("railway login");
    expect(exitCodeForError(err)).toBe(1);
  });

  it("maps unlinked directories to NOT_LINKED with a link suggestion", () => {
    const err = mapRailwayError(
      "No linked project found. Run railway link to connect to a project",
      1,
    );
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

describe("mapRailwayError project resolution", () => {
  it("treats the unlinked 'Project not found.' as NOT_LINKED", () => {
    const err = mapRailwayError(
      "Project not found. Run `railway link` to connect to a project.",
      1,
    );
    expect(err.code).toBe("NOT_LINKED");
  });

  it("treats an explicit bad project id as NOT_FOUND, not NOT_LINKED", () => {
    const err = mapRailwayError(
      'Project "00000000-0000-0000-0000-000000000000" not found',
      1,
    );
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toContain("not found");
  });

  it("treats a bad service name as NOT_FOUND", () => {
    expect(mapRailwayError("Service 'nope' not found", 1).code).toBe(
      "NOT_FOUND",
    );
  });

  it("maps a missing service link to NOT_LINKED with a --service hint", () => {
    const err = mapRailwayError(
      "No service linked. Use --service flag or --all to see all services",
      1,
    );
    expect(err.code).toBe("NOT_LINKED");
    expect(err.suggestions.join(" ")).toContain("--service");
  });

  it("maps the missing --environment complaint to VALIDATION_ERROR", () => {
    const err = mapRailwayError(
      "--environment is required when using --project",
      1,
    );
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(exitCodeForError(err)).toBe(2);
  });
});
