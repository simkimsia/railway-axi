import { execFile } from "node:child_process";
import {
  AxiError,
  mapRailwayError,
  railwayNotInstalledError,
  REPORT_SUGGESTION,
  UNKNOWN_SUGGESTION,
} from "./errors.js";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const MAX_BUFFER_BYTES = 10 * 1024 * 1024; // 10 MB

function run(args: string[]): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      "railway",
      args,
      { maxBuffer: MAX_BUFFER_BYTES },
      (error, stdout, stderr) => {
        if (error && (error as NodeJS.ErrnoException).code === "ENOENT") {
          resolve({ stdout: "", stderr: "ENOENT", exitCode: 127 });
          return;
        }
        const exitCode = error
          ? ((error as Error & { code?: string | number }).code ?? 1)
          : 0;
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          exitCode: typeof exitCode === "number" ? exitCode : 1,
        });
      },
    );
  });
}

/**
 * For calls whose stdout carries secrets (`variable list --json`, or `variable
 * set`, which may echo pairs): stdout never reaches an error message, and each
 * `redact` value is masked out of stderr before it is mapped.
 */
export interface SecretOptions {
  secret?: boolean;
  redact?: string[];
}

/** Mask each value out of text, longest first so overlapping values stay hidden. */
export function redactText(text: string, values: string[]): string {
  let out = text;
  const longestFirst = values
    .filter((v) => v !== "")
    .sort((a, b) => b.length - a.length);
  for (const value of longestFirst) {
    out = out.split(value).join("<redacted>");
  }
  return out;
}

async function runChecked(
  args: string[],
  opts: SecretOptions = {},
): Promise<string> {
  const result = await run(args);
  if (result.stderr === "ENOENT") throw railwayNotInstalledError();
  if (result.exitCode !== 0) {
    const text = opts.secret ? result.stderr : result.stderr || result.stdout;
    const error = mapRailwayError(
      redactText(text, opts.redact ?? []),
      result.exitCode,
    );
    if (opts.secret && error.code === "UNKNOWN") {
      throw new AxiError(error.message, error.code, [REPORT_SUGGESTION]);
    }
    throw error;
  }
  return result.stdout;
}

/** Execute railway and return parsed JSON. */
export async function railwayJson<T = unknown>(
  args: string[],
  opts: SecretOptions = {},
): Promise<T> {
  const stdout = await runChecked(args, opts);
  try {
    return JSON.parse(stdout) as T;
  } catch {
    throw new AxiError(
      opts.secret
        ? "Unexpected railway output (not shown: it may contain secret values)"
        : `Unexpected railway output: ${stdout.slice(0, 200)}`,
      "UNKNOWN",
      [opts.secret ? REPORT_SUGGESTION : UNKNOWN_SUGGESTION],
    );
  }
}

export interface NdjsonResult<T> {
  rows: T[];
  /** Lines that were not valid JSON and were skipped. */
  skipped: number;
}

/**
 * Parse newline-delimited JSON (`railway logs --json` emits one object per
 * line, not an array). Blank lines are ignored; unparseable lines are counted
 * rather than failing the whole call, since one garbled log line should not
 * hide the other 99.
 */
export function parseNdjson<T = unknown>(text: string): NdjsonResult<T> {
  const rows: T[] = [];
  let skipped = 0;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      rows.push(JSON.parse(trimmed) as T);
    } catch {
      skipped++;
    }
  }
  return { rows, skipped };
}

/** Execute railway and parse NDJSON stdout. */
export async function railwayNdjson<T = unknown>(
  args: string[],
): Promise<NdjsonResult<T>> {
  return parseNdjson<T>(await runChecked(args));
}

/** Execute railway and return raw stdout. */
export async function railwayExec(
  args: string[],
  opts: SecretOptions = {},
): Promise<string> {
  return runChecked(args, opts);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export interface ProjectRef {
  id: string;
  name: string;
  workspace?: { id: string; name: string };
}

/**
 * `railway service list` accepts a project id only, while `deployment list`
 * and `logs` accept a name or id. Resolve a name to its id via `railway list`
 * so every railway-axi command accepts either form.
 */
export async function resolveProjectId(nameOrId: string): Promise<string> {
  if (isUuid(nameOrId)) return nameOrId;
  const projects = await railwayJson<ProjectRef[]>(["list", "--json"]);
  return pickProjectId(nameOrId, projects);
}

/**
 * Railway allows the same project name in different workspaces and `list` is
 * account-wide, so a name can match more than one project. Names compare
 * case-insensitively, exactly as railway's own resolver does, so a name that
 * railway would call ambiguous is refused here too rather than guessed
 * (AXI §6); the candidates' ids let the agent retry unambiguously.
 */
export function pickProjectId(name: string, projects: ProjectRef[]): string {
  const wanted = name.toLowerCase();
  const matches = projects.filter((p) => p.name.toLowerCase() === wanted);
  if (matches.length === 1) return matches[0].id;
  if (matches.length > 1) {
    throw new AxiError(
      `Project "${name}" is ambiguous: ${matches.length} projects share that name`,
      "NOT_FOUND",
      [
        ...matches.map(
          (p) =>
            `${p.name} (${p.workspace?.name ?? "unknown workspace"}) ${p.id}`,
        ),
        "Retry with `--project <id>` to pick one",
      ],
    );
  }
  const names = projects.map((p) => p.name);
  throw new AxiError(`Project "${name}" not found`, "NOT_FOUND", [
    names.length > 0
      ? `Available projects: ${names.join(", ")}`
      : "No projects found in this account",
    "Run `railway-axi list` for details",
  ]);
}
