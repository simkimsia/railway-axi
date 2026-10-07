import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));

import { execFile } from "node:child_process";
import {
  debugLine,
  railwayExec,
  railwayJson,
  shellQuote,
} from "../src/railway.js";

function fakeRailway(stdout: string): void {
  vi.mocked(execFile).mockImplementation(((...callArgs: unknown[]) => {
    const callback = callArgs.at(-1) as (
      e: unknown,
      stdout: string,
      stderr: string,
    ) => void;
    callback(null, stdout, "");
  }) as unknown as typeof execFile);
}

describe("shellQuote", () => {
  it("leaves plain tokens bare", () => {
    expect(shellQuote("--service")).toBe("--service");
    expect(shellQuote("created:>=2026")).toBe("'created:>=2026'");
  });

  it("quotes spaces, empty tokens, and escapes single quotes", () => {
    expect(shellQuote("a b")).toBe("'a b'");
    expect(shellQuote("")).toBe("''");
    expect(shellQuote("O'Brien")).toBe(`'O'\\''Brien'`);
  });
});

describe("debugLine", () => {
  it("masks each redact value before quoting", () => {
    const line = debugLine(
      ["variable", "set", "--", "API_KEY=it's secret"],
      ["API_KEY=it's secret", "it's secret"],
    );
    expect(line).toBe("[axi-debug] railway variable set -- '<redacted>'");
    expect(line).not.toContain("secret'");
  });
});

describe("AXI_DEBUG", () => {
  let stderr: ReturnType<typeof vi.spyOn>;
  let stdout: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.mocked(execFile).mockReset();
    stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    stderr.mockRestore();
    stdout.mockRestore();
  });

  it("prints one argv line per call to stderr when set to 1", async () => {
    vi.stubEnv("AXI_DEBUG", "1");
    fakeRailway("[]");
    await railwayJson(["list", "--json"]);
    await railwayExec(["status"]);
    expect(stderr.mock.calls.map((c) => c[0])).toEqual([
      "[axi-debug] railway list --json\n",
      "[axi-debug] railway status\n",
    ]);
    expect(stdout).not.toHaveBeenCalled();
  });

  it("prints nothing when unset or set to another value", async () => {
    fakeRailway("[]");
    await railwayJson(["list", "--json"]);
    vi.stubEnv("AXI_DEBUG", "true");
    await railwayJson(["list", "--json"]);
    expect(stderr).not.toHaveBeenCalled();
  });

  it("masks redact values in the printed line", async () => {
    vi.stubEnv("AXI_DEBUG", "1");
    fakeRailway("");
    await railwayExec(["variable", "set", "--", "API_KEY=canary"], {
      secret: true,
      redact: ["API_KEY=canary", "canary"],
    });
    const printed = stderr.mock.calls.map((c) => String(c[0])).join("");
    expect(printed).toContain("[axi-debug] railway variable set --");
    expect(printed).not.toContain("canary");
  });
});
