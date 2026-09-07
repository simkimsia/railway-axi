import { describe, expect, it } from "vitest";
import { AxiError } from "../src/errors.js";
import { isUuid, parseNdjson, pickProjectId } from "../src/railway.js";

describe("parseNdjson", () => {
  it("parses one object per line and ignores blank lines", () => {
    const text = '{"a":1}\n\n{"a":2}\n';
    expect(parseNdjson(text)).toEqual({
      rows: [{ a: 1 }, { a: 2 }],
      skipped: 0,
    });
  });

  it("counts unparseable lines instead of failing", () => {
    const text = '{"a":1}\nnot json\n{"a":3}';
    expect(parseNdjson(text)).toEqual({
      rows: [{ a: 1 }, { a: 3 }],
      skipped: 1,
    });
  });

  it("returns no rows for empty output", () => {
    expect(parseNdjson("")).toEqual({ rows: [], skipped: 0 });
  });
});

describe("pickProjectId", () => {
  const projects = [
    { id: "11111111-1111-1111-1111-111111111111", name: "my-app" },
    { id: "22222222-2222-2222-2222-222222222222", name: "Other" },
  ];

  it("matches an exact name", () => {
    expect(pickProjectId("my-app", projects)).toBe(projects[0].id);
  });

  it("matches case-insensitively when unambiguous", () => {
    expect(pickProjectId("other", projects)).toBe(projects[1].id);
  });

  it("refuses a name shared by several projects and lists each candidate", () => {
    const dupes = [
      ...projects,
      {
        id: "33333333-3333-3333-3333-333333333333",
        name: "my-app",
        workspace: { id: "w1", name: "Team" },
      },
    ];
    try {
      pickProjectId("my-app", dupes);
      expect.unreachable("should have thrown");
    } catch (error) {
      const err = error as AxiError;
      expect(err.code).toBe("NOT_FOUND");
      expect(err.message).toContain("ambiguous");
      expect(err.suggestions).toContain(
        "my-app (unknown workspace) 11111111-1111-1111-1111-111111111111",
      );
      expect(err.suggestions).toContain(
        "my-app (Team) 33333333-3333-3333-3333-333333333333",
      );
      expect(err.suggestions.join(" ")).toContain("--project <id>");
    }
  });

  it("prefers the exact-case match over a case-insensitive duplicate", () => {
    const mixed = [
      ...projects,
      { id: "44444444-4444-4444-4444-444444444444", name: "My-App" },
    ];
    expect(pickProjectId("my-app", mixed)).toBe(projects[0].id);
  });

  it("throws NOT_FOUND listing the available names", () => {
    try {
      pickProjectId("nope", projects);
      expect.unreachable("should have thrown");
    } catch (error) {
      const err = error as AxiError;
      expect(err.code).toBe("NOT_FOUND");
      expect(err.suggestions.join(" ")).toContain("my-app, Other");
    }
  });
});

describe("isUuid", () => {
  it("recognises railway ids and rejects names", () => {
    expect(isUuid("a1d893cb-2ac2-4a2a-8c4f-d3ff67dfa5b0")).toBe(true);
    expect(isUuid("codeassure-github")).toBe(false);
  });
});
