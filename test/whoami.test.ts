import { describe, expect, it } from "vitest";
import { parseWhoami } from "../src/commands/whoami.js";

describe("parseWhoami", () => {
  it("extracts name and email from the standard output", () => {
    expect(parseWhoami("Logged in as Jane Doe (jane@example.com) 👋")).toEqual({
      user: { name: "Jane Doe", email: "jane@example.com" },
    });
  });

  it("falls back to the raw line when the shape changes", () => {
    expect(parseWhoami("some new format")).toEqual({ user: "some new format" });
  });
});
