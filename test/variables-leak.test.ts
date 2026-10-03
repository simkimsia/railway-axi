import { beforeEach, describe, expect, it, vi } from "vitest";

// Fake the railway binary itself, not railwayJson/railwayExec, so the real
// parse and error-mapping paths in src/railway.ts and src/errors.ts run.
vi.mock("node:child_process", () => ({ execFile: vi.fn() }));

import { execFile } from "node:child_process";
import { variablesCommand } from "../src/commands/variables.js";

const CANARY = "canary-secret-value";
const OTHER = "other-canary-secret";

interface FakeRun {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

function fakeRailway(run: FakeRun): void {
  vi.mocked(execFile).mockImplementation(((...callArgs: unknown[]) => {
    const callback = callArgs.at(-1) as (
      e: unknown,
      stdout: string,
      stderr: string,
    ) => void;
    const exitCode = run.exitCode ?? 0;
    const error =
      exitCode === 0
        ? null
        : Object.assign(new Error("exit"), { code: exitCode });
    callback(error, run.stdout ?? "", run.stderr ?? "");
  }) as unknown as typeof execFile);
}

/** Everything a caller could see: the output, or the rendered error parts. */
async function visible(args: string[]): Promise<string> {
  try {
    return await variablesCommand(args);
  } catch (error) {
    const e = error as { message?: string; suggestions?: string[] };
    return [e.message ?? "", ...(e.suggestions ?? [])].join("\n");
  }
}

beforeEach(() => {
  vi.mocked(execFile).mockReset();
});

// Each case is one way railway can misbehave. No case may surface a value
// other than the single one `get` asked for. Add a row for every new failure
// mode rather than a one-off test.
const cases: Array<{ name: string; args: string[]; run: FakeRun }> = [
  {
    name: "list: non-JSON stdout (warning before the JSON)",
    args: ["list", "--service", "web"],
    run: { stdout: `warning: update available\n{"API_KEY":"${CANARY}"}` },
  },
  {
    name: "get: non-JSON stdout",
    args: ["get", "PORT", "--service", "web"],
    run: { stdout: `warning\n{"PORT":"8080","API_KEY":"${CANARY}"}` },
  },
  {
    name: "list: failure with values on stdout and empty stderr",
    args: ["list", "--service", "web"],
    run: { stdout: `API_KEY=${CANARY}`, exitCode: 1 },
  },
  {
    name: "set: failure that echoes the pair on stderr",
    args: ["set", `API_KEY=${CANARY}`, "--service", "web"],
    run: { stderr: `error: failed to set API_KEY=${CANARY}`, exitCode: 1 },
  },
  {
    name: "set: failure with empty stderr that echoes the pair on stdout",
    args: ["set", `API_KEY=${CANARY}`, "--service", "web"],
    run: { stdout: `API_KEY=${CANARY}`, exitCode: 1 },
  },
  {
    name: "set: failure matching a known pattern that echoes the pair",
    args: ["set", `API_KEY=${CANARY}`, "--service", "web"],
    run: {
      stderr: `error: unexpected argument 'API_KEY=${CANARY}' found`,
      exitCode: 2,
    },
  },
  {
    name: "set: failure echoing a value that another value prefixes",
    args: ["set", "A=sk_live", `B=sk_live_${CANARY}`, "--service", "web"],
    run: {
      stderr: `error: failed to set A=sk_live B=sk_live_${CANARY}`,
      exitCode: 1,
    },
  },
  {
    name: "set: a bare value with no NAME=",
    args: ["set", "API_KEY=x", CANARY, "--service", "web"],
    run: {},
  },
  {
    name: "set: a pair whose name starts with a dash",
    args: ["set", `-K=${CANARY}`, "--service", "web"],
    run: {},
  },
  {
    name: "set: success that echoes values",
    args: ["set", `API_KEY=${CANARY}`, "--service", "web"],
    run: { stdout: `Set API_KEY=${CANARY}` },
  },
];

describe("variables never leaks a value", () => {
  it.each(cases)("$name", async ({ args, run }) => {
    fakeRailway(run);
    const out = await visible(args);
    expect(out).not.toContain(CANARY);
  });

  it("get prints the requested value and no other", async () => {
    fakeRailway({ stdout: JSON.stringify({ PORT: CANARY, API_KEY: OTHER }) });
    const out = await visible(["get", "PORT", "--service", "web"]);
    expect(out).toContain(CANARY);
    expect(out).not.toContain(OTHER);
  });

  it("list prints names only", async () => {
    fakeRailway({ stdout: JSON.stringify({ PORT: CANARY, API_KEY: OTHER }) });
    const out = await visible(["list", "--service", "web"]);
    expect(out).toContain("API_KEY");
    expect(out).not.toContain(CANARY);
    expect(out).not.toContain(OTHER);
  });
});
