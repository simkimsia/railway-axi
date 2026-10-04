import { beforeEach, describe, expect, it, vi } from "vitest";

// Fake the railway binary itself, not railwayJson/railwayExec, so the real
// parse and error-mapping paths in src/railway.ts and src/errors.ts run.
vi.mock("node:child_process", () => ({ execFile: vi.fn() }));

import { execFile } from "node:child_process";
import { variablesCommand } from "../src/commands/variables.js";
import { REPORT_SUGGESTION } from "../src/errors.js";

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
    name: "set: a dash-leading pair right after a scope flag",
    args: ["set", "--service", `-K=${CANARY}`],
    run: {},
  },
  {
    name: "get: a dash-leading token right after a scope flag",
    args: ["get", "PORT", "--service", `-K=${CANARY}`],
    run: {},
  },
  {
    name: "list: a dash-leading token right after a scope flag",
    args: ["list", "--environment", `-K=${CANARY}`],
    run: {},
  },
  {
    name: "get: a NAME=value pair instead of a NAME",
    args: ["get", `API_KEY=${CANARY}`, "--service", "web"],
    run: { stdout: JSON.stringify({ PORT: "8080" }) },
  },
  {
    name: "get: a stray value after the NAME",
    args: ["get", "API_KEY", CANARY, "--service", "web"],
    run: {},
  },
  {
    name: "list: a dash-leading NAME=value token",
    args: ["list", `-K=${CANARY}`, "--service", "web"],
    run: {},
  },
  {
    name: "set: a scope flag that swallowed a pair, railway echoing it",
    args: ["set", "--service", `API_KEY=${CANARY}`, "OTHER=1"],
    run: {
      stderr: `error: Service 'API_KEY=${CANARY}' not found`,
      exitCode: 1,
    },
  },
  {
    name: "unknown subcommand that is really a value",
    args: [CANARY, "--service", "web"],
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

  it.each([
    { name: "list", args: ["list", "--service", "web"] },
    { name: "get", args: ["get", "PORT", "--service", "web"] },
    { name: "set", args: ["set", "A=1", "--service", "web"] },
  ])(
    "$name: an unrecognized railway failure suggests only reporting the gap",
    async ({ args }) => {
      fakeRailway({ stderr: "error: something new went wrong", exitCode: 1 });
      await expect(variablesCommand(args)).rejects.toMatchObject({
        code: "UNKNOWN",
        suggestions: [REPORT_SUGGESTION],
      });
    },
  );

  it("list prints names only", async () => {
    fakeRailway({ stdout: JSON.stringify({ PORT: CANARY, API_KEY: OTHER }) });
    const out = await visible(["list", "--service", "web"]);
    expect(out).toContain("API_KEY");
    expect(out).not.toContain(CANARY);
    expect(out).not.toContain(OTHER);
  });
});

// The table above holds the cases someone thought of. This sweep holds the
// ones nobody did: the canary goes into every position of each subcommand's
// argv in every shape an agent could mistype, and railway fails echoing its
// whole argv. Bare-token shapes go only at the end, where the canary cannot
// legitimately be a scope flag's value or the NAME `get` reads.
describe("variables never leaks a value from any argv position", () => {
  const BASES: Record<string, string[]> = {
    list: ["list", "--service", "web"],
    get: ["get", "PORT", "--service", "web"],
    set: ["set", "A=1", "--service", "web"],
  };
  const SHAPES: string[][] = [
    [`-${CANARY}`],
    [`--${CANARY}`],
    [`X=${CANARY}`],
    [`-X=${CANARY}`],
    [`--service=X=${CANARY}`],
    ["--service", `-${CANARY}`],
    ["--service", `X=${CANARY}`],
    ["--environment", `-${CANARY}`],
    ["--skip-deploys", `-${CANARY}`],
  ];
  const TAIL_SHAPES: string[][] = [[CANARY], ["-", CANARY]];

  const sweep: Array<{ label: string; args: string[] }> = [];
  for (const [sub, base] of Object.entries(BASES)) {
    for (const shape of SHAPES) {
      for (let at = 1; at <= base.length; at++) {
        const args = [...base.slice(0, at), ...shape, ...base.slice(at)];
        sweep.push({ label: args.join(" "), args });
      }
    }
    for (const shape of TAIL_SHAPES) {
      const args = [...base, ...shape];
      sweep.push({ label: args.join(" "), args });
    }
    // A bare `variables` with flags lists, so sweep that form too.
    if (sub === "list") {
      for (const shape of SHAPES) {
        const args = [...shape, "--service", "web"];
        sweep.push({ label: args.join(" "), args });
      }
    }
  }

  it.each(sweep)("$label", async ({ args }) => {
    vi.mocked(execFile).mockImplementation(((...callArgs: unknown[]) => {
      const argv = callArgs[1] as string[];
      const callback = callArgs.at(-1) as (
        e: unknown,
        stdout: string,
        stderr: string,
      ) => void;
      const echo = `error: ${argv.join(" ")}`;
      callback(Object.assign(new Error("exit"), { code: 1 }), echo, echo);
    }) as unknown as typeof execFile);
    const out = await visible(args);
    expect(out).not.toContain(CANARY);
  });
});
