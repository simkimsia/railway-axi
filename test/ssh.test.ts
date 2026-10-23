import { beforeEach, describe, expect, it, vi } from "vitest";

// Fake the railway binary itself so no test can reach a real `railway ssh`,
// and so the real argv building in src/railway.ts runs.
vi.mock("node:child_process", () => ({ execFile: vi.fn() }));

import { execFile } from "node:child_process";
import {
  ALLOWED,
  parseSshCommand,
  renderSsh,
  sshCommand,
  SSH_LINES_DEFAULT,
} from "../src/commands/ssh.js";
import { AxiError } from "../src/errors.js";

interface FakeRun {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  killed?: boolean;
}

/** Queue fake railway runs in call order; returns the recorded argv lists. */
function fakeRailway(...runs: FakeRun[]): string[][] {
  const calls: string[][] = [];
  vi.mocked(execFile).mockImplementation(((...callArgs: unknown[]) => {
    calls.push(callArgs[1] as string[]);
    const run = runs.shift() ?? {};
    const callback = callArgs.at(-1) as (
      e: unknown,
      stdout: string,
      stderr: string,
    ) => void;
    const exitCode = run.exitCode ?? 0;
    const error = run.killed
      ? Object.assign(new Error("killed"), { killed: true, code: null })
      : exitCode === 0
        ? null
        : Object.assign(new Error("exit"), { code: exitCode });
    callback(error, run.stdout ?? "", run.stderr ?? "");
    return { stdin: { end: vi.fn() } };
  }) as unknown as typeof execFile);
  return calls;
}

async function refusal(args: string[]): Promise<AxiError> {
  try {
    await sshCommand(args);
  } catch (error) {
    expect(error).toBeInstanceOf(AxiError);
    return error as AxiError;
  }
  throw new Error(`expected a refusal for ${args.join(" ")}`);
}

beforeEach(() => {
  vi.mocked(execFile).mockReset();
});

describe("ssh allowed commands", () => {
  it("forwards an allowlisted command after -- with the scope in equals form", async () => {
    const calls = fakeRailway({ stdout: "1\n42\nself\n" });
    const out = await sshCommand(["--service", "web", "--", "ls", "/proc"]);
    expect(calls).toEqual([["ssh", "--service=web", "--", "ls", "/proc"]]);
    expect(out).toContain("service: web");
    expect(out).toContain("command: ls /proc");
    expect(out).toContain("exit: 0");
    expect(out).toContain("stdout[3]:\n  1\n  42\n  self");
  });

  it("splits one quoted command string the way the remote shell would", async () => {
    const calls = fakeRailway({ stdout: "x\n" });
    await sshCommand(["--service=web", "--", "ls -la\t/app"]);
    expect(calls[0]).toEqual([
      "ssh",
      "--service=web",
      "--",
      "ls",
      "-la",
      "/app",
    ]);
  });

  it.each([
    ["ps", "aux"],
    ["ps", "-ef"],
    ["ps", "-o", "pid,user,args"],
    ["ps", "-o", "user"],
    ["tail", "-n", "50", "/app/log/app.log"],
    ["head", "-c", "100", "/etc/os-release"],
    ["cat", "/proc/1/cmdline"],
    ["df", "-h"],
    ["du", "-sh", "/app"],
    ["date", "+%s"],
    ["date", "-u"],
    ["uname", "-a"],
    ["free", "-m"],
    ["pwd"],
    ["whoami"],
    ["hostname"],
    ["stat", "/app/package.json"],
    ["wc", "-l", "/app/log/app.log"],
  ])("allows %s", (...words) => {
    expect(parseSshCommand(words, {}).words).toEqual(words);
  });

  it("resolves the one service when none is named, then forwards it", async () => {
    const calls = fakeRailway(
      { stdout: JSON.stringify([{ id: "s1", name: "web" }]) },
      { stdout: "ok\n" },
    );
    const out = await sshCommand(["--", "pwd"]);
    expect(calls[0]).toEqual(["service", "list", "--json"]);
    expect(calls[1]).toEqual(["ssh", "--service=web", "--", "pwd"]);
    expect(out).toContain("service: web");
  });

  it("refuses to guess between several services", async () => {
    const calls = fakeRailway({
      stdout: JSON.stringify([
        { id: "s1", name: "web" },
        { id: "s2", name: "worker" },
      ]),
    });
    const error = await refusal(["--", "pwd"]);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.suggestions.join("\n")).toContain("web, worker");
    expect(calls).toHaveLength(1);
  });

  it("truncates stdout to --lines and long lines, with a hint for more", async () => {
    const many = Array.from({ length: 250 }, (_, i) => `line${i}`).join("\n");
    fakeRailway({ stdout: `${many}\n` });
    const out = await sshCommand(["--service", "web", "--", "ps", "aux"]);
    expect(out).toContain(`lines: ${SSH_LINES_DEFAULT} of 250`);
    expect(out).toContain(`stdout[${SSH_LINES_DEFAULT}]:`);
    expect(out).not.toContain(`line${SSH_LINES_DEFAULT}\n`);
    expect(out).toContain("--lines 250");

    fakeRailway({ stdout: `${"x".repeat(1000)}\n` });
    const long = await sshCommand([
      "--service",
      "web",
      "--lines",
      "5",
      "--",
      "cat",
      "/a",
    ]);
    expect(long).toContain(`${"x".repeat(299)}…`);
    expect(long).not.toContain("x".repeat(300));
  });

  it("reports a failing remote command as output, with its exit code and stderr", async () => {
    fakeRailway({
      exitCode: 2,
      stderr: "ls: cannot access '/nope': No such file or directory\n",
    });
    const out = await sshCommand(["--service", "web", "--", "ls", "/nope"]);
    expect(out).toContain("exit: 2");
    expect(out).toContain("stderr[1]:");
    expect(out).toContain("No such file or directory");
    expect(out).toContain("exited 2");
  });

  it("raises railway's own auth failure as an error", async () => {
    fakeRailway({ exitCode: 1, stderr: "Unauthorized. Please login" });
    const error = await refusal(["--service", "web", "--", "pwd"]);
    expect(error.code).toBe("AUTH");
  });

  it("raises an unknown service as NOT_FOUND", async () => {
    fakeRailway({ exitCode: 1, stderr: 'Service "nope" not found' });
    const error = await refusal(["--service", "nope", "--", "pwd"]);
    expect(error.code).toBe("NOT_FOUND");
  });

  it("reports a timeout instead of hanging", async () => {
    fakeRailway({ killed: true });
    const error = await refusal(["--service", "web", "--", "cat", "/a"]);
    expect(error.message).toContain("did not finish");
  });
});

describe("ssh refusals happen before any railway call", () => {
  it.each([
    ["shell sequence", ["ls", ";", "rm", "-rf", "/"]],
    ["semicolon glued", ["ls;rm", "-rf", "/"]],
    ["and", ["ls", "&&", "rm", "x"]],
    ["or", ["ls", "||", "rm", "x"]],
    ["pipe", ["ps", "aux", "|", "grep", "node"]],
    ["redirect out", ["cat", "/a", ">", "/b"]],
    ["redirect in", ["cat", "<", "/a"]],
    ["command substitution", ["ls", "$(rm -rf /)"]],
    ["backticks", ["ls", "`id`"]],
    ["variable expansion", ["cat", "$HOME/.profile"]],
    ["glob", ["cat", "/proc/1/envir?n"]],
    ["star glob", ["cat", "/proc/*/cmdline"]],
    ["brace expansion", ["cat", "/proc/1/{environ,cmdline}"]],
    ["quotes", ["cat", "'/a'"]],
    ["double quotes", ["cat", '"/a"']],
    ["backslash", ["cat", "/proc/1/envir\\on"]],
    ["newline", ["ls\nrm -rf /"]],
    ["background", ["ls", "&"]],
    ["tilde", ["cat", "~/.bashrc"]],
    ["comment", ["ls", "#x"]],
    ["subshell", ["(ls)"]],
  ])("refuses %s", async (_label, words) => {
    const calls = fakeRailway();
    const error = await refusal(["--service", "web", "--", ...words]);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.suggestions.join("\n")).toContain(
      "railway ssh --service web -- <cmd>",
    );
    expect(calls).toEqual([]);
  });

  it.each([
    ["env"],
    ["printenv"],
    ["printenv", "DATABASE_URL"],
    ["export"],
    ["set"],
  ])("refuses %s with a names-only route", async (...words) => {
    const calls = fakeRailway();
    const error = await refusal(["--service", "web", "--", ...words]);
    expect(error.message).toContain("environment values");
    expect(error.suggestions.join("\n")).toContain(
      "railway-axi variables list --service web",
    );
    expect(calls).toEqual([]);
  });

  it.each([
    ["cat", "/proc/1/environ"],
    ["cat", "/proc/self/environ"],
    ["head", "/proc/self/root/proc/1/environ"],
    ["cat", "/app/.env"],
    ["cat", ".env"],
    ["cat", "/app/.env.production"],
    ["tail", "/run/secrets/db"],
    ["cat", "/run//secrets/x"],
    ["cat", "/run/./secrets/x"],
    ["cat", "/run/x/../secrets/x"],
    ["du", "--files0-from=/run/x/../secrets/x"],
    ["cat", "/var/run/secrets/kubernetes.io/serviceaccount/token"],
    ["cat", "run/secrets/x"],
    ["cat", "secrets/x"],
    ["cat", "/root/.ssh/id_rsa"],
    ["cat", "/home/app/.netrc"],
    ["cat", "/root/.pgpass"],
    ["cat", "/app/.npmrc"],
    ["cat", "/root/.aws/credentials"],
    ["du", "--files0-from=/proc/1/environ"],
  ])("refuses secret path %s %s", async (...words) => {
    const calls = fakeRailway();
    const error = await refusal(["--service", "web", "--", ...words]);
    expect(error.message).toContain("secret values");
    expect(calls).toEqual([]);
  });

  it.each([
    ["rm", "-rf", "/"],
    ["sh", "-c", "id"],
    ["bash"],
    ["find", "/", "-delete"],
    ["grep", "-r", "SECRET", "/proc"],
    ["kill", "1"],
    ["node", "-e", "1"],
    ["strings", "/proc/1/cmdline"],
    ["echo", "hi"],
    ["xargs", "rm"],
    ["toString"],
    ["constructor"],
    ["-la"],
  ])("refuses %s (not on the allowlist)", async (...words) => {
    const calls = fakeRailway();
    const error = await refusal(["--service", "web", "--", ...words]);
    expect(error.message).toContain("not on the read-only allowlist");
    expect(error.suggestions.join("\n")).toContain(
      `Allowed: ${Object.keys(ALLOWED).join(", ")}`,
    );
    expect(calls).toEqual([]);
  });

  it.each([
    [["tail", "-f", "/a"], "never exits"],
    [["tail", "-F", "/a"], "never exits"],
    [["tail", "-fn", "10", "/a"], "never exits"],
    [["tail", "--follow=name", "/a"], "never exits"],
    [["tail", "--retry", "/a"], "never exits"],
    [["ps", "aux", "e"], "process environments"],
    [["ps", "eww"], "process environments"],
    [["ps", "auxe"], "process environments"],
    [["date", "-s", "2020-01-01"], "set the clock"],
    [["date", "--set=2020-01-01"], "set the clock"],
    [["date", "010100002020"], "set the clock"],
    [["hostname", "evil"], "no arguments"],
    [["pwd", "-P"], "no arguments"],
    [["uname", "/etc"], "flags only"],
  ])("refuses %j", async (words, reason) => {
    const calls = fakeRailway();
    const error = await refusal(["--service", "web", "--", ...words]);
    expect(error.message).toContain(reason);
    expect(calls).toEqual([]);
  });

  it("refuses a command longer than the cap", async () => {
    const calls = fakeRailway();
    const error = await refusal([
      "--service",
      "web",
      "--",
      "ls",
      `/${"a".repeat(600)}`,
    ]);
    expect(error.message).toContain("longer than");
    expect(calls).toEqual([]);
  });

  it("needs a command after --", async () => {
    const calls = fakeRailway();
    expect((await refusal(["--service", "web"])).message).toContain(
      "needs a command",
    );
    expect((await refusal(["--service", "web", "--"])).message).toContain(
      "needs a command",
    );
    expect(calls).toEqual([]);
  });

  it("points a command given without -- at the right shape", async () => {
    const calls = fakeRailway();
    const error = await refusal(["ls", "/app", "--service", "web"]);
    expect(error.message).toContain("after `--`");
    expect(calls).toEqual([]);
  });

  it("rejects an unknown flag before -- by name", async () => {
    const calls = fakeRailway();
    const error = await refusal(["--service", "web", "--session", "--", "pwd"]);
    expect(error.message).toContain("unknown flag --session");
    expect(calls).toEqual([]);
  });
});

describe("ssh hints quote the scope", () => {
  it("quotes a spaced service in the plain-railway refusal hint", () => {
    try {
      parseSshCommand(["rm", "x"], { service: "my web" });
      expect.unreachable("should have refused");
    } catch (error) {
      expect((error as AxiError).suggestions).toContain(
        "Run plain `railway ssh --service 'my web' -- <cmd>` yourself for anything else",
      );
    }
  });

  it("quotes the scope in the non-zero exit hint", () => {
    const out = renderSsh(
      { stdout: "", stderr: "ls: /nope: No such file", exitCode: 2 },
      { name: "ls", words: ["ls", "/nope"] },
      { service: "my web", environment: "-e" },
      SSH_LINES_DEFAULT,
    );
    expect(out).toContain(
      "railway-axi ssh --service 'my web' --environment=-e -- ls <dir>",
    );
  });
});
