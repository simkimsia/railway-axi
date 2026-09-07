export type ErrorCode =
  | "AUTH"
  | "NOT_LINKED"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "RAILWAY_NOT_INSTALLED"
  | "UNKNOWN";

export class AxiError extends Error {
  readonly code: ErrorCode;
  readonly suggestions: string[];

  constructor(message: string, code: ErrorCode, suggestions: string[] = []) {
    super(message);
    this.name = "AxiError";
    this.code = code;
    this.suggestions = suggestions;
  }
}

export function exitCodeForError(error: AxiError): number {
  return error.code === "VALIDATION_ERROR" ? 2 : 1;
}

export function railwayNotInstalledError(): AxiError {
  return new AxiError(
    "Railway CLI is not installed or not on PATH",
    "RAILWAY_NOT_INSTALLED",
    ["Install it: `brew install railway` or `npm install -g @railway/cli`"],
  );
}

interface ErrorPattern {
  pattern: RegExp;
  code: ErrorCode;
  message?: string;
  suggestions: string[];
}

// Walked in order; first regex hit wins, so narrow patterns must sit ahead of
// broader ones (same contract as gh-axi's mapGhError).
const patterns: ErrorPattern[] = [
  {
    pattern: /unauthorized|not logged in|login state is corrupt|no user token/i,
    code: "AUTH",
    message: "Not logged in to Railway",
    suggestions: ["Run `railway login` in an interactive terminal, then retry"],
  },
  {
    pattern: /no service linked/i,
    code: "NOT_LINKED",
    message: "No service is linked to this directory",
    suggestions: [
      "Pass `--service <name>`; run `railway-axi services` to see names",
    ],
  },
  {
    // Unlinked directory: railway says exactly "Project not found. Run
    // `railway link` ..." (no name quoted). An explicit bad id reads
    // `Project "<id>" not found`, which must fall through to NOT_FOUND.
    pattern:
      /no linked project|not linked|link a project|^project not found\./i,
    code: "NOT_LINKED",
    message: "No Railway project is linked to this directory",
    suggestions: [
      "Run `railway-axi list` to see projects",
      "Pass `--project <name> --environment <env>` to target one without linking",
      "Run `railway link -p <project>` to link one, then retry",
    ],
  },
  {
    pattern: /not found|does not exist/i,
    code: "NOT_FOUND",
    suggestions: [
      "Run `railway-axi list` to see available projects",
      "Run `railway-axi services` to see service names in the environment",
    ],
  },
  {
    pattern: /--environment is required/i,
    code: "VALIDATION_ERROR",
    message: "--environment is required when --project is given",
    suggestions: ["Add `--environment <name>` (for example `production`)"],
  },
];

/** Translate raw railway CLI stderr into a structured, actionable AxiError. */
export function mapRailwayError(stderr: string, exitCode: number): AxiError {
  const trimmed = stderr.trim();
  for (const entry of patterns) {
    if (entry.pattern.test(trimmed)) {
      return new AxiError(
        entry.message ?? firstLine(trimmed),
        entry.code,
        entry.suggestions,
      );
    }
  }
  return new AxiError(
    firstLine(trimmed) || `railway exited with code ${exitCode}`,
    "UNKNOWN",
  );
}

function firstLine(text: string): string {
  return text.split("\n", 1)[0] ?? "";
}
