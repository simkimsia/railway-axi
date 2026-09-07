import {
  assertNoArgs,
  takeBoolFlag,
  takeFlag,
  takeIntFlag,
  takePositional,
} from "../args.js";
import { AxiError } from "../errors.js";
import {
  assertServiceUnambiguous,
  fetchServices,
  scopeArgs,
  takeScope,
  type Scope,
} from "../scope.js";
import { railwayNdjson, type NdjsonResult } from "../railway.js";
import { renderHelp, renderList, renderOutput } from "../toon.js";

export const LOGS_LINES_DEFAULT = 100;
export const LOGS_LINES_MAX = 500;
export const LOGS_MESSAGE_MAX = 200;

export const LOGS_HELP = `usage: railway-axi logs [deployment-id] [flags]
Fetches recent log lines and exits. Never streams: --lines is always applied.
flags[7]:
  --lines <n>           lines to fetch (default ${LOGS_LINES_DEFAULT}, max ${LOGS_LINES_MAX})
  --build               build logs instead of deploy logs
  --http                HTTP request logs instead of deploy logs
  --filter <expr>       railway log filter, e.g. "@level:error"
  --service <name|id>   service to read; required when the environment has several and none is linked (a deployment id does not pin it)
  --project <name|id>   project to read (requires --environment); default: linked project
  --environment <name>  environment to read; default: linked environment
examples:
  railway-axi logs
  railway-axi logs --lines 500 --filter "@level:error"
  railway-axi logs --build <deployment-id>
  railway-axi logs --project my-app --environment production --service web --http --lines 50
`;

export type LogKind = "deploy" | "build" | "http";

export interface RailwayLogLine {
  timestamp?: string;
  level?: string;
  message?: string;
  [key: string]: unknown;
}

export async function logsCommand(args: string[]): Promise<string> {
  const scope = takeScope(args);
  const lines = takeIntFlag(
    args,
    "--lines",
    LOGS_LINES_DEFAULT,
    LOGS_LINES_MAX,
  );
  const build = takeBoolFlag(args, "--build");
  const http = takeBoolFlag(args, "--http");
  const filter = takeFlag(args, "--filter");
  const deploymentId = takePositional(args);
  assertNoArgs("logs", args);

  if (build && http) {
    throw new AxiError(
      "--build and --http are mutually exclusive",
      "VALIDATION_ERROR",
    );
  }
  const kind: LogKind = build ? "build" : http ? "http" : "deploy";

  // Only an explicit --service skips the lookup. A deployment id does not
  // pin the service for railway: with --project/--environment and no
  // --service it refuses with "No service linked" even when the id is valid.
  let resolved: Scope = scope;
  if (!scope.service) {
    const service = assertServiceUnambiguous(
      scope,
      await fetchServices(scope),
      "logs",
    );
    resolved = { ...scope, service };
  }

  const ctx: LogsContext = { kind, lines, scope: resolved, deploymentId };
  const result = await railwayNdjson<RailwayLogLine>(logsArgs(ctx, filter));
  return renderLogs(result, ctx);
}

export interface LogsContext {
  kind: LogKind;
  lines: number;
  scope: Scope;
  deploymentId?: string;
}

/**
 * Build the raw `railway logs` argv. `--filter` goes in equals form because
 * railway's clap definition rejects a dash-leading value in the space form
 * (`--filter -@method:OPTIONS` -> "unexpected argument '-@'"), and negation
 * filters are documented to start with a dash.
 */
export function logsArgs(ctx: LogsContext, filter?: string): string[] {
  const args = ["logs", "--json", "--lines", String(ctx.lines)];
  if (ctx.kind === "build") args.push("--build");
  if (ctx.kind === "http") args.push("--http");
  if (filter) args.push(`--filter=${filter}`);
  args.push(...scopeArgs(ctx.scope));
  if (ctx.deploymentId) args.push(ctx.deploymentId);
  return args;
}

function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\s*\n\s*/g, " ⏎ ");
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function messageRow(r: RailwayLogLine): Record<string, unknown> {
  return {
    time: str(r.timestamp),
    level: str(r.level),
    message: truncate(
      typeof r.message === "string" ? r.message : JSON.stringify(r),
      LOGS_MESSAGE_MAX,
    ),
  };
}

/**
 * `--http --json` lines carry no message; each is a structured request record
 * (method, path, httpStatus, totalDuration, ...). Show the fields an agent
 * asks for and drop the routing internals.
 */
function httpRow(r: RailwayLogLine): Record<string, unknown> {
  return {
    time: str(r.timestamp),
    method: str(r.method),
    path: truncate(str(r.path), LOGS_MESSAGE_MAX),
    status: typeof r.httpStatus === "number" ? r.httpStatus : str(r.httpStatus),
    ms: typeof r.totalDuration === "number" ? r.totalDuration : "",
  };
}

export function renderLogs(
  result: NdjsonResult<RailwayLogLine>,
  ctx: LogsContext,
): string {
  const { rows, skipped } = result;
  const parts: string[] = [`kind: ${ctx.kind}`];
  if (ctx.deploymentId) parts.push(`deployment: ${ctx.deploymentId}`);
  else if (ctx.scope.service) parts.push(`service: ${ctx.scope.service}`);
  if (ctx.scope.environment) parts.push(`env: ${ctx.scope.environment}`);
  const where = ` (${parts.join(", ")})`;
  const skippedNote = skipped > 0 ? `, ${skipped} unparseable skipped` : "";

  if (rows.length === 0) {
    const why =
      ctx.kind === "build"
        ? " (build logs are empty for image-based deploys)"
        : "";
    return renderOutput([
      `logs: 0 lines${where}${why}${skippedNote}`,
      renderHelp([
        "Run `railway-axi deployments` to pick a deployment id",
        ctx.kind === "deploy"
          ? "Try `--http` for request logs or `--build` for build logs"
          : "Drop `--build`/`--http` for deploy (runtime) logs",
      ]),
    ]);
  }

  const table = ctx.kind === "http" ? rows.map(httpRow) : rows.map(messageRow);
  const cmd = ctx.kind === "deploy" ? "logs" : `logs --${ctx.kind}`;
  const errorFilter =
    ctx.kind === "http" ? "@httpStatus:>=400" : "@level:error";
  const hints = [
    `Run \`railway-axi ${cmd} --lines ${LOGS_LINES_MAX}\` for more history`,
    `Run \`railway-axi ${cmd} --filter "${errorFilter}"\` to narrow to errors`,
  ];
  if (rows.length + skipped >= ctx.lines) {
    hints.unshift(`Showing the newest ${rows.length} of possibly more lines`);
  }
  return renderOutput([
    `count: ${rows.length} lines${where}${skippedNote}`,
    renderList("logs", table),
    renderHelp(hints),
  ]);
}
