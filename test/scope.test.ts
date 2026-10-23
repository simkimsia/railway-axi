import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { AxiError } from "../src/errors.js";
import {
  assertServiceUnambiguous,
  scopeArgs,
  scopeHint,
  takeScope,
  type RailwayService,
} from "../src/scope.js";

const svc = (name: string, isLinked = false): RailwayService => ({
  id: `id-${name}`,
  name,
  isLinked,
});

describe("takeScope", () => {
  it("takes the three shared flags and leaves the rest", () => {
    const args = [
      "--project",
      "p",
      "--environment",
      "e",
      "--service",
      "s",
      "--limit",
      "3",
    ];
    expect(takeScope(args)).toEqual({
      project: "p",
      environment: "e",
      service: "s",
    });
    expect(args).toEqual(["--limit", "3"]);
  });

  it("requires --environment alongside --project, before any railway call", () => {
    try {
      takeScope(["--project", "p"]);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as AxiError).code).toBe("VALIDATION_ERROR");
      expect((error as AxiError).message).toContain("--environment");
    }
  });

  it("allows --environment on its own (linked project)", () => {
    expect(takeScope(["--environment", "staging"])).toEqual({
      project: undefined,
      environment: "staging",
      service: undefined,
    });
  });
});

describe("scopeArgs", () => {
  it("emits only the flags that were set, in equals form", () => {
    expect(scopeArgs({ environment: "e", service: "s" })).toEqual([
      "--environment=e",
      "--service=s",
    ]);
    expect(scopeArgs({})).toEqual([]);
  });

  it("keeps dash-leading values attached so clap cannot mistake them for flags", () => {
    expect(
      scopeArgs({ project: "-p", environment: "-e", service: "-s" }),
    ).toEqual(["--project=-p", "--environment=-e", "--service=-s"]);
  });
});

describe("assertServiceUnambiguous", () => {
  it("returns the explicit service untouched", () => {
    expect(
      assertServiceUnambiguous(
        { service: "api" },
        [svc("web"), svc("api")],
        "logs",
      ),
    ).toBe("api");
  });

  it("returns the only service when there is one", () => {
    expect(assertServiceUnambiguous({}, [svc("web")], "logs")).toBe("web");
  });

  it("returns the linked service in a linked directory", () => {
    expect(
      assertServiceUnambiguous({}, [svc("web"), svc("api", true)], "logs"),
    ).toBe("api");
  });

  it("ignores the link when --project targets another project explicitly", () => {
    expect(() =>
      assertServiceUnambiguous(
        { project: "p", environment: "e" },
        [svc("web"), svc("api", true)],
        "deployments",
      ),
    ).toThrow(/pass --service/);
  });

  it("refuses to guess among several services and lists them", () => {
    try {
      assertServiceUnambiguous({}, [svc("web"), svc("api")], "deployments");
      expect.unreachable("should have thrown");
    } catch (error) {
      const err = error as AxiError;
      expect(err.code).toBe("VALIDATION_ERROR");
      expect(err.suggestions.join(" ")).toContain("web, api");
      expect(err.suggestions.join(" ")).toContain(
        "railway-axi deployments --service",
      );
    }
  });
});

/** Split a hint the way a POSIX shell would, so the test proves it copies. */
function shellWords(hint: string): string[] {
  const out = execFileSync("sh", ["-c", `printf '%s\\0' ${hint}`], {
    encoding: "utf8",
  });
  return out.split("\0").slice(0, -1);
}

describe("scopeHint", () => {
  it("prints plain values bare, in service, project, environment order", () => {
    expect(
      scopeHint({ project: "p", environment: "production", service: "web" }),
    ).toBe(" --service web --project p --environment production");
    expect(scopeHint({})).toBe("");
  });

  it("single-quotes values with spaces or shell metacharacters", () => {
    expect(scopeHint({ service: "my web" })).toBe(" --service 'my web'");
    expect(scopeHint({ service: "a;b" })).toBe(" --service 'a;b'");
    expect(scopeHint({ environment: "$HOME" })).toBe(" --environment '$HOME'");
    expect(scopeHint({ service: "O'Brien" })).toBe(` --service 'O'\\''Brien'`);
  });

  it("uses --flag=value for a value that starts with a dash", () => {
    expect(scopeHint({ service: "-web" })).toBe(" --service=-web");
    expect(scopeHint({ service: "-my web" })).toBe(" --service='-my web'");
  });

  it.each([
    { service: "web" },
    { service: "my web", environment: "staging" },
    { service: "it's a `web` $(app) & co", environment: "-e x" },
    { project: "my app", environment: "pr #12", service: "-s;rm" },
  ])("round-trips through a real shell into takeScope: %o", (scope) => {
    const args = shellWords(scopeHint(scope));
    expect(takeScope(args)).toEqual({
      project: scope.project,
      environment: scope.environment,
      service: scope.service,
    });
    expect(args).toEqual([]);
  });
});
