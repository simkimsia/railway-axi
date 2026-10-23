import { posix } from "node:path";
import { assertNoArgs, takeIntFlag } from "../args.js";
import { AxiError, mapRailwayError } from "../errors.js";
import { railwayRun, type ExecResult } from "../railway.js";
import {
  resolveScope,
  scopeArgs,
  scopeHint,
  takeScope,
  type Scope,
} from "../scope.js";
import { encode, renderHelp, renderOutput } from "../toon.js";

export const SSH_LINES_DEFAULT = 100;
export const SSH_LINES_MAX = 1000;
export const SSH_LINE_MAX = 300;
const SSH_STDERR_LINES = 20;
const SSH_TIMEOUT_MS = 60_000;
const SSH_COMMAND_MAX = 512;

/**
 * Read-only commands an agent may run. Anything else is refused before any
 * railway call. Each entry says which arguments it takes:
 * - "none": no arguments at all (`hostname x` would set the hostname);
 * - "flags": option tokens only;
 * - "any": options and operands (paths), each checked against SENSITIVE.
 */
type ArgPolicy = "none" | "flags" | "any";

export const ALLOWED: Record<string, ArgPolicy> = {
  ls: "any",
  cat: "any",
  head: "any",
  tail: "any",
  wc: "any",
  stat: "any",
  du: "any",
  df: "any",
  ps: "any",
  id: "any",
  uname: "flags",
  uptime: "flags",
  free: "flags",
  date: "any",
  pwd: "none",
  whoami: "none",
  hostname: "none",
};

/** Commands that print environment values; refused with a names-only route. */
const ENV_COMMANDS = new Set(["env", "printenv", "export", "set", "declare"]);

/**
 * The remote side runs the line through a shell, so every character that
 * means something to a shell (`;`, `&`, `|`, `<`, `>`, `$`, backticks,
 * quotes, globs, `~`, braces, parens, `#`, `!`, `\`) is refused in the whole
 * line, not just argv[0]. What is left are plain words split on whitespace,
 * exactly as the remote shell will split them.
 */
const SAFE_LINE = /^[A-Za-z0-9_./:=,@%+\- \t]*$/;

/**
 * Paths whose contents are secrets even through an allowed reader: process
 * environments (the same values `variables` never lists), dotenv files,
 * mounted secrets and credential files. Best effort: a symlink to one of these
 * under another name is not caught, which is one reason the reader set is
 * small.
 */
const SENSITIVE: RegExp[] = [
  /environ/i,
  /(^|[/=])\.env($|[./])/i,
  /\/run\/secrets/i,
  /(^|[/=])\.ssh($|\/)/i,
  /(^|[/=])\.(netrc|pgpass|npmrc|git-credentials|aws|docker|kube)($|\/)/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)/i,
];

/**
 * The word as typed plus the normalized forms the remote kernel resolves it
 * to (`/run//secrets`, `/run/./secrets`, `/run/x/../secrets`), for the word
 * and for a flag value after `=`.
 */
function pathSpellings(word: string): string[] {
  const eq = word.indexOf("=");
  const parts = eq === -1 ? [word] : [word, word.slice(eq + 1)];
  return [word, ...parts.map((p) => posix.normalize(p).replace(/\/+/g, "/"))];
}

export interface SshCommand {
  name: string;
  words: string[];
}

function refuse(reason: string, scope: Scope, extra: string[] = []): AxiError {
  return new AxiError(reason, "VALIDATION_ERROR", [
    ...extra,
    `Allowed: ${Object.keys(ALLOWED).join(", ")}`,
    `Run plain \`railway ssh${scopeHint(scope)} -- <cmd>\` yourself for anything else`,
  ]);
}

/**
 * Validate the remote command line and split it into words. Throws
 * VALIDATION_ERROR (exit 2) for anything outside the allowlist; the line is
 * never forwarded in that case.
 */
export function parseSshCommand(tokens: string[], scope: Scope): SshCommand {
  const line = tokens.join(" ").trim();
  if (line === "") {
    throw new AxiError("ssh needs a command after `--`", "VALIDATION_ERROR", [
      "Use `railway-axi ssh --service <name> -- ls /app`",
      `Allowed: ${Object.keys(ALLOWED).join(", ")}`,
    ]);
  }
  if (line.length > SSH_COMMAND_MAX) {
    throw refuse(`command is longer than ${SSH_COMMAND_MAX} characters`, scope);
  }
  if (!SAFE_LINE.test(line)) {
    const bad = [...line].find((c) => !SAFE_LINE.test(c)) ?? "";
    throw refuse(
      `command contains ${JSON.stringify(bad)}; shell operators, quotes, globs and substitutions are refused`,
      scope,
      [
        "Run one command per call: split `a && b` or `a | b` into separate `railway-axi ssh` calls",
      ],
    );
  }
  const words = line.split(/[ \t]+/);
  const name = words[0];
  if (ENV_COMMANDS.has(name)) {
    throw refuse(
      `\`${name}\` is refused: it prints environment values, which are secrets`,
      scope,
      [
        `Run \`railway-axi variables list${scopeHint(scope)}\` for variable names`,
      ],
    );
  }
  const policy = Object.hasOwn(ALLOWED, name) ? ALLOWED[name] : undefined;
  if (policy === undefined) {
    throw refuse(`\`${name}\` is not on the read-only allowlist`, scope);
  }
  const rest = words.slice(1);
  if (policy === "none" && rest.length > 0) {
    throw refuse(`\`${name}\` takes no arguments here`, scope);
  }
  if (policy === "flags") {
    const operand = rest.find((w) => !w.startsWith("-"));
    if (operand !== undefined) {
      throw refuse(`\`${name}\` takes flags only, got ${operand}`, scope);
    }
  }
  for (const word of rest) {
    if (pathSpellings(word).some((p) => SENSITIVE.some((re) => re.test(p)))) {
      throw refuse(
        `${word} is refused: it can hold secret values (process environments, dotenv files, credentials)`,
        scope,
        [
          `Run \`railway-axi variables list${scopeHint(scope)}\` for variable names`,
        ],
      );
    }
  }
  checkCommandFlags(name, rest, scope);
  return { name, words };
}

/** ps flags whose next word is a value (a format, user or pid list), not an option. */
const PS_VALUE_FLAGS = new Set([
  "-o",
  "-O",
  "-p",
  "-u",
  "-U",
  "-g",
  "-G",
  "-t",
  "-C",
  "-k",
  "--format",
  "--sort",
  "--pid",
  "--user",
]);

/** Per-command flags that stream forever, change state or print environments. */
function checkCommandFlags(name: string, rest: string[], scope: Scope): void {
  if (name === "tail") {
    const follows = rest.find(
      (w) =>
        w === "--follow" ||
        w.startsWith("--follow=") ||
        w === "--retry" ||
        (/^-[^-]/.test(w) && /[fF]/.test(w)),
    );
    if (follows) {
      throw refuse(`\`tail ${follows}\` is refused: it never exits`, scope, [
        "Use `tail -n 100 <file>` for a fixed number of lines",
      ]);
    }
  }
  if (name === "ps") {
    // BSD-style options (no dash) with `e` print each process's environment
    // (`ps aux e`, `ps eww`); `-e` with a dash means every process and stays.
    // A word that is the value of a value-taking flag (`-o user`) is not one.
    const env = rest.find(
      (w, i) =>
        /^[A-Za-z]+$/.test(w) &&
        /e/.test(w) &&
        !PS_VALUE_FLAGS.has(rest[i - 1] ?? ""),
    );
    if (env) {
      throw refuse(
        `\`ps ${env}\` is refused: the BSD \`e\` option prints process environments`,
        scope,
        ["Use `ps aux` or `ps -ef`"],
      );
    }
  }
  if (name === "date") {
    // `date -s` and `date MMDDhhmm` set the clock; only `+FORMAT` and flags
    // other than set pass.
    const sets = rest.find(
      (w) =>
        w === "-s" ||
        w.startsWith("--set") ||
        (/^-[^-]/.test(w) && w.includes("s")) ||
        (!w.startsWith("-") && !w.startsWith("+")),
    );
    if (sets) {
      throw refuse(`\`date ${sets}\` is refused: it can set the clock`, scope, [
        "Use `date`, `date -u` or `date +%s`",
      ]);
    }
  }
}

export const SSH_HELP = `usage: railway-axi ssh [flags] -- <command> [args...]
Runs one read-only command in a service container and exits. Never opens an interactive shell.
Only an allowlist runs: ${Object.keys(ALLOWED).join(", ")}.
Refused before any railway call: anything else, shell operators (; && || | < > $ \` quotes globs), env/printenv, and paths that hold secrets (/proc/*/environ, .env, /run/secrets, credential files).
flags[4]:
  --lines <n>           stdout lines to print (default ${SSH_LINES_DEFAULT}, max ${SSH_LINES_MAX}); each line is cut at ${SSH_LINE_MAX} characters
  --service <name|id>   service to connect to; required when the environment has several and none is linked
  --project <name|id>   project to use (requires --environment); default: linked project
  --environment <name>  environment to use; default: linked environment
examples:
  railway-axi ssh --service web -- ls /proc
  railway-axi ssh --service web -- ps aux
  railway-axi ssh --service web --lines 20 -- tail -n 200 /app/log/app.log
  railway-axi ssh --project my-app --environment production --service web -- df -h
`;

/** Split argv at the first `--`: railway-axi flags before, the remote command after. */
function splitAtDashDash(args: string[]): {
  flags: string[];
  command: string[] | undefined;
} {
  const idx = args.indexOf("--");
  if (idx === -1) return { flags: args, command: undefined };
  return { flags: args.slice(0, idx), command: args.slice(idx + 1) };
}

export async function sshCommand(args: string[]): Promise<string> {
  const { flags, command } = splitAtDashDash(args);
  const scope = takeScope(flags);
  const lines = takeIntFlag(flags, "--lines", SSH_LINES_DEFAULT, SSH_LINES_MAX);
  if (command === undefined) {
    if (flags.length > 0 && !flags[0].startsWith("-")) {
      throw new AxiError(
        "Put the remote command after `--`",
        "VALIDATION_ERROR",
        [`Use \`railway-axi ssh${scopeHint(scope)} -- ${flags.join(" ")}\``],
      );
    }
    assertNoArgs("ssh", flags);
    throw new AxiError("ssh needs a command after `--`", "VALIDATION_ERROR", [
      `Use \`railway-axi ssh${scopeHint(scope)} -- ls /app\``,
      `Allowed: ${Object.keys(ALLOWED).join(", ")}`,
    ]);
  }
  assertNoArgs("ssh", flags);
  const parsed = parseSshCommand(command, scope);

  const resolved = await resolveScope(scope, "ssh");
  const result = await railwayRun(
    ["ssh", ...scopeArgs(resolved), "--", ...parsed.words],
    { timeoutMs: SSH_TIMEOUT_MS },
  );
  return renderSsh(result, parsed, resolved, lines);
}

/**
 * Railway's own failures (not logged in, unknown service) arrive on the same
 * stderr as the remote command's. Only the unmistakable ones are raised as
 * errors; everything else is the command's own output and exit code.
 */
function railwayFailure(result: ExecResult): AxiError | undefined {
  if (result.exitCode === 0 || result.stdout.trim() !== "") return undefined;
  const mapped = mapRailwayError(result.stderr, result.exitCode);
  if (mapped.code === "AUTH" || mapped.code === "NOT_LINKED") return mapped;
  if (
    mapped.code === "NOT_FOUND" &&
    /\b(service|project|environment|deployment|instance)\b[^\n]*not found/i.test(
      result.stderr,
    )
  ) {
    return mapped;
  }
  return undefined;
}

function toLines(text: string): string[] {
  const out = text.replace(/\r/g, "").split("\n");
  if (out.at(-1) === "") out.pop();
  return out;
}

function cut(line: string): string {
  return line.length > SSH_LINE_MAX
    ? `${line.slice(0, SSH_LINE_MAX - 1)}…`
    : line;
}

function block(label: string, lines: string[]): string {
  if (lines.length === 0) return "";
  return `${label}[${lines.length}]:\n${lines.map((l) => `  ${cut(l)}`).join("\n")}`;
}

export function renderSsh(
  result: ExecResult,
  parsed: SshCommand,
  scope: Scope,
  maxLines: number,
): string {
  const failure = railwayFailure(result);
  if (failure) throw failure;
  if (result.timedOut) {
    throw new AxiError(
      `\`${parsed.words.join(" ")}\` did not finish within ${SSH_TIMEOUT_MS / 1000}s`,
      "UNKNOWN",
      ["Narrow the command (a smaller path, `head -n`), then retry"],
    );
  }
  const target = scopeHint(scope);
  const stdout = toLines(result.stdout);
  const shown = stdout.slice(0, maxLines);
  const stderr = toLines(result.stderr).slice(-SSH_STDERR_LINES);
  const body = {
    ssh: {
      ...(scope.service ? { service: scope.service } : {}),
      ...(scope.environment ? { environment: scope.environment } : {}),
      command: parsed.words.join(" "),
      exit: result.exitCode,
      lines:
        shown.length < stdout.length
          ? `${shown.length} of ${stdout.length}`
          : stdout.length,
    },
  };
  const help: string[] = [];
  if (result.overflow) {
    help.push("Output passed 10 MB and was cut off; narrow the command");
  }
  if (shown.length < stdout.length) {
    help.push(
      `Showing the first ${shown.length} lines; pass \`--lines ${Math.min(stdout.length, SSH_LINES_MAX)}\` for more`,
    );
  }
  if (result.exitCode !== 0) {
    help.push(
      `The command exited ${result.exitCode}; see stderr, or run \`railway-axi ssh${target} -- ls <dir>\` to check a path`,
    );
  }
  return renderOutput([
    encode(body),
    block("stdout", shown),
    block("stderr", stderr),
    renderHelp(help),
  ]);
}
