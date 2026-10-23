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
 * - "any": options and operands, each checked against SENSITIVE; the file
 *   commands in OPTION_SPECS also need every path they read or list to be
 *   under READABLE_TREES or READABLE_FILES.
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
 * mounted secrets and credential files. A denylist is best effort (a symlink
 * or an unusual name is not caught), so it is the second layer: the first is
 * READABLE, which every path a file command touches must be under.
 */
const SENSITIVE: RegExp[] = [
  /environ/i,
  /(^|[/=])\.env(rc)?($|[./])/i,
  /(^|[/=])secrets($|\/)/i,
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

/**
 * Directory trees a file command may touch: the path itself and everything
 * below it. `/app` is where Railway's builders (Railpack, Nixpacks) put the
 * app; `/var/log` holds system and app log files; `/sys/fs/cgroup` holds the
 * container's memory and CPU limits and usage (why was it OOM-killed).
 */
export const READABLE_TREES = ["/app", "/var/log", "/sys/fs/cgroup"];

/**
 * Single files outside those trees: the OS release, system-wide load and
 * memory, and the per-process files that show what `ps` shows. Never
 * `/proc/<pid>/environ`, `root`, `cwd`, `fd` or `mem`, which reach other
 * files or a process's memory.
 */
export const READABLE_FILES: RegExp[] = [
  /^\/etc\/os-release$/,
  /^\/proc\/(meminfo|loadavg|uptime|cpuinfo|version)$/,
  /^\/proc\/(\d+|self)\/(cmdline|status|stat|statm|limits)$/,
];

const READABLE_HINT =
  `Readable paths: ${READABLE_TREES.join(", ")} and below; /etc/os-release, ` +
  "/proc/{meminfo,loadavg,uptime,cpuinfo,version}, " +
  "/proc/<pid>/{cmdline,status,stat,statm,limits}";

/** `/app//log/` and `/app/./log` are `/app/log`; a trailing `/` is dropped. */
function canonicalPath(path: string): string {
  const normal = posix.normalize(path).replace(/\/+/g, "/");
  return normal.length > 1 ? normal.replace(/\/$/, "") : normal;
}

export function isReadablePath(path: string): boolean {
  const canonical = canonicalPath(path);
  return (
    READABLE_TREES.some(
      (tree) => canonical === tree || canonical.startsWith(`${tree}/`),
    ) || READABLE_FILES.some((re) => re.test(canonical))
  );
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
  const spec = Object.hasOwn(OPTION_SPECS, name)
    ? OPTION_SPECS[name]
    : undefined;
  if (spec !== undefined) {
    const parsed = parseOptions(name, rest, spec, scope);
    for (const path of parsed.paths) checkPath(path, scope);
    if (PATH_OPERANDS.has(name)) {
      for (const operand of parsed.operands) checkPath(operand, scope);
    }
    checkParsed(name, parsed, scope);
  }
  checkCommandFlags(name, rest, scope);
  return { name, words };
}

/**
 * How an option uses a value: "flag" takes none, "value" takes a non-path
 * value (attached or the next word), "optional" takes one only attached
 * (`-Iseconds`, `--color=auto`), and "path" takes a file it reads.
 */
type OptKind = "flag" | "value" | "optional" | "path";

interface OptionSpec {
  short: Record<string, OptKind>;
  long: Record<string, OptKind>;
}

/**
 * Options of the commands that take paths (GNU coreutils and busybox), so a
 * value such as `head -n 50` is not mistaken for a path and a path hidden in
 * an option (`du --files0-from=F`, `date -f F`) is checked. A short option
 * not listed is taken as a flag; a long one not listed never consumes the
 * next word, which is then checked as a path, and an abbreviation of one that
 * takes a value must be written with `=`: an unknown option can only make the
 * check stricter.
 */
const OPTION_SPECS: Record<string, OptionSpec> = {
  cat: { short: {}, long: {} },
  head: {
    short: { n: "value", c: "value" },
    long: { lines: "value", bytes: "value" },
  },
  tail: {
    short: { n: "value", c: "value", s: "value" },
    long: {
      lines: "value",
      bytes: "value",
      "sleep-interval": "value",
      pid: "value",
      "max-unchanged-stats": "value",
      follow: "optional",
      retry: "flag",
    },
  },
  wc: {
    short: {},
    long: { "files0-from": "path", total: "value" },
  },
  stat: {
    short: { c: "value" },
    long: { format: "value", printf: "value", cached: "value" },
  },
  du: {
    short: { d: "value", B: "value", t: "value", X: "path" },
    long: {
      "max-depth": "value",
      "block-size": "value",
      threshold: "value",
      exclude: "value",
      "exclude-from": "path",
      "files0-from": "path",
      time: "optional",
      "time-style": "value",
    },
  },
  ls: {
    short: { I: "value", w: "value", T: "value" },
    long: {
      ignore: "value",
      hide: "value",
      width: "value",
      tabsize: "value",
      "block-size": "value",
      "time-style": "value",
      format: "value",
      sort: "value",
      time: "value",
      color: "optional",
      "indicator-style": "value",
      "quoting-style": "value",
    },
  },
  date: {
    short: {
      d: "value",
      D: "value",
      s: "value",
      I: "optional",
      f: "path",
      r: "path",
    },
    long: {
      date: "value",
      set: "value",
      file: "path",
      reference: "path",
      "iso-8601": "optional",
      "rfc-3339": "value",
      debug: "flag",
      utc: "flag",
      universal: "flag",
      "rfc-email": "flag",
    },
  },
};

/** Commands whose operands are paths (date's operand is a format). */
const PATH_OPERANDS = new Set([
  "cat",
  "head",
  "tail",
  "wc",
  "stat",
  "du",
  "ls",
]);

interface ParsedOptions {
  /** Short option letters seen, value-taking ones included. */
  short: Set<string>;
  /** Long option names seen; an abbreviation adds every name it could mean. */
  long: Set<string>;
  /** Values of options that read a file. */
  paths: string[];
  operands: string[];
}

/**
 * Split the words the way getopt does: clustered short options, attached or
 * separate values, `--name=value`, unique-prefix abbreviations of long names,
 * options after operands, and `--` ending the options.
 */
function parseOptions(
  name: string,
  rest: string[],
  spec: OptionSpec,
  scope: Scope,
): ParsedOptions {
  const parsed: ParsedOptions = {
    short: new Set(),
    long: new Set(),
    paths: [],
    operands: [],
  };
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i];
    if (word === "--") {
      parsed.operands.push(...rest.slice(i + 1));
      break;
    }
    if (word === "-" || !word.startsWith("-")) {
      parsed.operands.push(word);
      continue;
    }
    if (word.startsWith("--")) {
      const eq = word.indexOf("=");
      const given = eq === -1 ? word.slice(2) : word.slice(2, eq);
      const exact = Object.hasOwn(spec.long, given);
      const names = exact
        ? [given]
        : Object.keys(spec.long).filter((k) => k.startsWith(given));
      if (
        eq === -1 &&
        !exact &&
        names.some((n) => spec.long[n] !== "flag")
      ) {
        throw refuse(
          `\`${name} ${word}\` is refused: write a long option that takes a value in full or as --name=value`,
          scope,
          [READABLE_HINT],
        );
      }
      for (const n of names) parsed.long.add(n);
      const isPath = names.some((n) => spec.long[n] === "path");
      if (eq !== -1) {
        // A value for an option we do not know is checked as a path too.
        if (isPath || names.length === 0) parsed.paths.push(word.slice(eq + 1));
      } else if (exact && spec.long[given] === "path") {
        if (i + 1 < rest.length) parsed.paths.push(rest[++i]);
      } else if (exact && spec.long[given] === "value") {
        i++;
      }
      continue;
    }
    for (let j = 1; j < word.length; j++) {
      const letter = word[j];
      const kind = Object.hasOwn(spec.short, letter)
        ? spec.short[letter]
        : "flag";
      if (kind === "flag" && !/[A-Za-z0-9]/.test(letter)) {
        throw refuse(
          `\`${name} ${word}\` is refused: options with a path attached are not read`,
          scope,
          [READABLE_HINT],
        );
      }
      parsed.short.add(letter);
      if (kind === "flag") continue;
      const attached = word.slice(j + 1);
      if (kind === "optional") break;
      const value =
        attached !== ""
          ? attached
          : i + 1 < rest.length
            ? rest[++i]
            : undefined;
      if (kind === "path" && value !== undefined) parsed.paths.push(value);
      break;
    }
  }
  return parsed;
}

/**
 * A path a file command reads or lists must sit under READABLE. The remote
 * working directory is unknown (`/` when an image sets no WORKDIR), so a
 * relative path could name any file and is refused; so is any `..`, which the
 * kernel resolves after symlinks and so can leave a readable tree even when
 * the spelling stays inside it. `-` is stdin, which is closed.
 */
function checkPath(path: string, scope: Scope): void {
  if (path === "-") return;
  if (path.split("/").includes("..")) {
    throw refuse(
      `${path} is refused: \`..\` can climb out of a readable directory`,
      scope,
      [READABLE_HINT],
    );
  }
  const canonical = canonicalPath(path);
  if (SENSITIVE.some((re) => re.test(canonical))) {
    throw refuse(
      `${path} is refused: it can hold secret values (process environments, dotenv files, credentials)`,
      scope,
      [
        `Run \`railway-axi variables list${scopeHint(scope)}\` for variable names`,
      ],
    );
  }
  if (!canonical.startsWith("/")) {
    throw refuse(
      `${path} is relative and the remote working directory is unknown; name an absolute path`,
      scope,
      [
        `Run \`railway-axi ssh${scopeHint(scope)} -- pwd\` to see the working directory`,
        READABLE_HINT,
      ],
    );
  }
  if (!isReadablePath(canonical)) {
    throw refuse(`${path} is outside the paths ssh may read`, scope, [
      READABLE_HINT,
    ]);
  }
}

/** Rules that need the parsed options: streaming, clock setting, no directory. */
function checkParsed(name: string, parsed: ParsedOptions, scope: Scope): void {
  if (
    (name === "ls" || name === "du") &&
    parsed.operands.length === 0 &&
    !(name === "du" && parsed.long.has("files0-from"))
  ) {
    throw refuse(
      `\`${name}\` needs a directory: the remote working directory is unknown`,
      scope,
      [
        `Use \`railway-axi ssh${scopeHint(scope)} -- ${name} /app\``,
        READABLE_HINT,
      ],
    );
  }
  if (name === "tail") {
    if (
      parsed.short.has("f") ||
      parsed.short.has("F") ||
      parsed.long.has("follow") ||
      parsed.long.has("retry")
    ) {
      throw refuse(
        "`tail` with follow or retry is refused: it never exits",
        scope,
        ["Use `tail -n 100 <file>` for a fixed number of lines"],
      );
    }
  }
  if (name === "date") {
    // `date -s`/`--set` and an operand other than `+FORMAT` (`date MMDDhhmm`)
    // set the clock; `-d <date>` only prints it.
    const operand = parsed.operands.find((w) => !w.startsWith("+"));
    if (
      parsed.short.has("s") ||
      parsed.long.has("set") ||
      operand !== undefined
    ) {
      throw refuse(
        `\`date ${operand ?? (parsed.short.has("s") ? "-s" : "--set")}\` is refused: it can set the clock`,
        scope,
        ["Use `date`, `date -u`, `date +%s` or `date -d <date>`"],
      );
    }
  }
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

/** ps flags that print environments (tail and date are in checkParsed). */
function checkCommandFlags(name: string, rest: string[], scope: Scope): void {
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
}

export const SSH_HELP = `usage: railway-axi ssh [flags] -- <command> [args...]
Runs one read-only command in a service container and exits. Never opens an interactive shell.
Only an allowlist runs: ${Object.keys(ALLOWED).join(", ")}.
Refused before any railway call: anything else, shell operators (; && || | < > $ \` quotes globs), env/printenv, and paths that hold secrets (/proc/*/environ, .env, /run/secrets, credential files).
File commands (ls cat head tail wc stat du, date -f/-r) read only absolute paths under ${READABLE_TREES.join(", ")}, plus /etc/os-release, /proc/{meminfo,loadavg,uptime,cpuinfo,version} and /proc/<pid>/{cmdline,status,stat,statm,limits}; relative paths and .. are refused.
flags[4]:
  --lines <n>           stdout lines to print (default ${SSH_LINES_DEFAULT}, max ${SSH_LINES_MAX}); each line is cut at ${SSH_LINE_MAX} characters
  --service <name|id>   service to connect to; required when the environment has several and none is linked
  --project <name|id>   project to use (requires --environment); default: linked project
  --environment <name>  environment to use; default: linked environment
examples:
  railway-axi ssh --service web -- ls -la /app
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
