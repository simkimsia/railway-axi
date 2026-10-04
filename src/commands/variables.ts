import {
  assertNoArgs,
  isOptionToken,
  takeBoolFlag,
  takePositional,
} from "../args.js";
import {
  AxiError,
  REPORT_SUGGESTION,
  UNKNOWN_SUGGESTION,
} from "../errors.js";
import {
  railwayExec,
  railwayJson,
  redactText,
  resolveProjectId,
} from "../railway.js";
import {
  assertServiceUnambiguous,
  fetchServices,
  scopeArgs,
  takeScope,
  type Scope,
} from "../scope.js";
import { encode, renderHelp, renderOutput } from "../toon.js";

export const VARIABLES_HELP = `usage: railway-axi variables <list|get|set> [flags]
Reads and sets the variables of one service. Values are secrets: \`list\` prints names only, \`get\` prints one value, \`set\` never echoes a value.
subcommands[3]:
  list                    variable names of the service (default when no subcommand is given)
  get <NAME>              the value of one variable
  set <NAME=value>...     set one or more variables; triggers a redeploy unless --skip-deploys
flags[4]:
  --service <name|id>   service to use; required when the environment has several and none is linked
  --project <name|id>   project to use (requires --environment); default: linked project
  --environment <name>  environment to use; default: linked environment
  --skip-deploys        set only: do not redeploy, so several sets can share one later deploy
examples:
  railway-axi variables list --service web
  railway-axi variables get DATABASE_URL --service web
  railway-axi variables set FEATURE_X=true --service web --environment production
  railway-axi variables set A=1 B=2 --service web --skip-deploys
`;

const SUBCOMMANDS = ["list", "get", "set"];
const SCOPE_FLAGS = ["--project", "--environment", "--service"];

const KNOWN_FLAGS = [...SCOPE_FLAGS, "--skip-deploys"];

/**
 * Every argv text that may be a secret value. This is an allowlist: a token is
 * safe only when it is the subcommand, a known flag, a scope flag's value
 * with no `=`, or the one NAME `get` reads (picked by takePositional's own
 * rule). Everything else is masked, so an odd token cannot slip through a
 * case nobody thought of. A token with `=` also contributes its value alone,
 * because railway may echo just the value.
 */
function secretCandidates(argv: string[]): string[] {
  const out: string[] = [];
  const mask = (t: string) => {
    out.push(t);
    if (t.includes("=")) out.push(t.slice(t.indexOf("=") + 1));
  };
  let sub = "list";
  let i = 0;
  if (argv[0] !== undefined && !argv[0].startsWith("-")) {
    sub = argv[0];
    if (!SUBCOMMANDS.includes(sub)) mask(sub);
    i = 1;
  }
  let nameSeen = false;
  for (; i < argv.length; i++) {
    const token = argv[i];
    const scopeEq = SCOPE_FLAGS.find((f) => token.startsWith(`${f}=`));
    if (scopeEq !== undefined) {
      const value = token.slice(scopeEq.length + 1);
      if (value.includes("=")) mask(value);
      continue;
    }
    if (SCOPE_FLAGS.includes(token)) {
      const next = argv[i + 1];
      if (next !== undefined && !isOptionToken(next) && !next.includes("=")) {
        i++;
      }
      continue;
    }
    if (KNOWN_FLAGS.includes(token)) continue;
    if (sub === "get" && !nameSeen && !isOptionToken(token)) {
      nameSeen = true;
      if (!token.includes("=")) continue;
    }
    mask(token);
  }
  return out.filter((v) => v !== "");
}

function maskError(error: unknown, secrets: string[]): AxiError {
  if (!(error instanceof AxiError)) {
    return new AxiError(
      "`variables` failed unexpectedly (details not shown: they may contain a value)",
      "UNKNOWN",
      [REPORT_SUGGESTION],
    );
  }
  return new AxiError(
    redactText(error.message, secrets),
    error.code,
    error.suggestions.map((s) =>
      s === UNKNOWN_SUGGESTION ? REPORT_SUGGESTION : redactText(s, secrets),
    ),
  );
}

export async function variablesCommand(args: string[]): Promise<string> {
  const secrets = secretCandidates(args);
  try {
    return await dispatch(args, secrets);
  } catch (error) {
    throw maskError(error, secrets);
  }
}

async function dispatch(args: string[], secrets: string[]): Promise<string> {
  // A bare `variables` (or one that starts with a flag) lists, the safe read.
  const sub =
    args[0] === undefined || args[0].startsWith("-") ? "list" : args.shift()!;
  switch (sub) {
    case "list":
      return listVariables(args, secrets);
    case "get":
      return getVariable(args, secrets);
    case "set":
      return setVariables(args, secrets);
    default:
      throw new AxiError(
        `unknown subcommand ${sub} for \`variables\``,
        "VALIDATION_ERROR",
        [
          `Subcommands: ${SUBCOMMANDS.join(", ")}`,
          "Run `railway-axi variables --help` for usage",
        ],
      );
  }
}

/**
 * `railway variable` takes a project id only, and errors when no service is
 * linked. Resolve both up front: a project name becomes its id, and a missing
 * --service is either the one unambiguous service or a refusal (AXI §6),
 * which matters most for `set`.
 */
async function resolveScope(scope: Scope, command: string): Promise<Scope> {
  const withId: Scope = scope.project
    ? { ...scope, project: await resolveProjectId(scope.project) }
    : scope;
  if (withId.service) return withId;
  return {
    ...withId,
    service: assertServiceUnambiguous(
      withId,
      await fetchServices(withId),
      command,
    ),
  };
}

function takeVariablesScope(args: string[]): Scope {
  const scope = takeScope(args);
  for (const [key, value] of Object.entries(scope)) {
    if (value?.includes("=")) {
      throw new AxiError(
        `--${key} was given a NAME=value pair as its value (not shown: it may be a value)`,
        "VALIDATION_ERROR",
        [
          `Give --${key} a name, then the pairs: \`--${key} <name> NAME=value\``,
        ],
      );
    }
  }
  return scope;
}

function fetchVariables(
  scope: Scope,
  secrets: string[],
): Promise<Record<string, string>> {
  return railwayJson<Record<string, string>>(
    ["variable", "list", "--json", ...scopeArgs(scope)],
    { secret: true, redact: secrets },
  );
}

function where(scope: Scope): string {
  const parts: string[] = [];
  if (scope.service) parts.push(`service: ${scope.service}`);
  if (scope.environment) parts.push(`env: ${scope.environment}`);
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

async function listVariables(
  args: string[],
  secrets: string[],
): Promise<string> {
  const scope = takeVariablesScope(args);
  assertNoArgs("variables list", args);
  const resolved = await resolveScope(scope, "variables list");
  return renderVariableNames(await fetchVariables(resolved, secrets), resolved);
}

export function renderVariableNames(
  variables: Record<string, string>,
  scope: Scope,
): string {
  const names = Object.keys(variables).sort();
  if (names.length === 0) {
    return renderOutput([
      `variables: 0 variables${where(scope)}`,
      renderHelp([
        "Run `railway-axi variables set <NAME=value>` to add one (triggers a redeploy)",
      ]),
    ]);
  }
  return renderOutput([
    `count: ${names.length} variables${where(scope)}, values hidden`,
    encode({ variables: names }),
    renderHelp(["Run `railway-axi variables get <NAME>` to read one value"]),
  ]);
}

async function getVariable(args: string[], secrets: string[]): Promise<string> {
  const scope = takeVariablesScope(args);
  const name = takePositional(args);
  if (name === undefined) {
    throw new AxiError(
      "`variables get` requires a variable name",
      "VALIDATION_ERROR",
      ["Run `railway-axi variables get <NAME> [--service <name>]`"],
    );
  }
  if (name.includes("=")) {
    throw new AxiError(
      "`variables get` takes a NAME, not NAME=value (not shown: it may be a value)",
      "VALIDATION_ERROR",
      ["Run `railway-axi variables set <NAME=value>` to set a variable"],
    );
  }
  assertNoArgs("variables get", args);
  const resolved = await resolveScope(scope, "variables get");
  return renderVariable(
    name,
    await fetchVariables(resolved, secrets),
    resolved,
  );
}

export function renderVariable(
  name: string,
  variables: Record<string, string>,
  scope: Scope,
): string {
  if (!Object.hasOwn(variables, name)) {
    throw new AxiError(
      `Variable "${name}" not found${where(scope)}`,
      "NOT_FOUND",
      ["Run `railway-axi variables list` to see variable names"],
    );
  }
  return encode({
    variable: {
      name,
      value: variables[name],
      ...(scope.service ? { service: scope.service } : {}),
      ...(scope.environment ? { environment: scope.environment } : {}),
    },
  });
}

/** Indexes into `original` of the tokens takeScope and --skip-deploys left. */
function pairSlots(original: string[]): number[] {
  const taken = new Set<number>();
  const take = (match: (a: string) => boolean): number => {
    const i = original.findIndex((a, j) => !taken.has(j) && match(a));
    if (i !== -1) taken.add(i);
    return i;
  };
  for (const flag of SCOPE_FLAGS) {
    const i = take((a) => a === flag || a.startsWith(`${flag}=`));
    if (i !== -1 && original[i] === flag) taken.add(i + 1);
  }
  take((a) => a === "--skip-deploys");
  return original.map((_, i) => i).filter((i) => !taken.has(i));
}

// Railway splits each pair on the first `=`, so only the name is constrained.
const PAIR_RE = /^[^\s=]+=/;

async function setVariables(
  args: string[],
  secrets: string[],
): Promise<string> {
  const original = [...args];
  const scope = takeVariablesScope(args);
  const skipDeploys = takeBoolFlag(args, "--skip-deploys");
  const pairs = args;
  if (pairs.length === 0) {
    throw new AxiError(
      "`variables set` requires at least one NAME=value pair",
      "VALIDATION_ERROR",
      ["Run `railway-axi variables set <NAME=value> [--service <name>]`"],
    );
  }
  // Report only the position: a stray token may be carrying a secret.
  const bad = pairs.findIndex((p) => p.startsWith("-") || !PAIR_RE.test(p));
  if (bad !== -1) {
    throw new AxiError(
      `argument ${pairSlots(original)[bad] + 1} of \`variables set\` is not NAME=value or a known flag (not shown: it may be a value)`,
      "VALIDATION_ERROR",
      [
        'Quote the pair if the value has spaces: `"NAME=some value"`',
        "Flags: --service, --project, --environment, --skip-deploys",
      ],
    );
  }
  const resolved = await resolveScope(scope, "variables set");
  // Stdout is discarded and kept out of errors: the raw CLI may echo values.
  await railwayExec(
    [
      "variable",
      "set",
      ...(skipDeploys ? ["--skip-deploys"] : []),
      ...scopeArgs(resolved),
      "--",
      ...pairs,
    ],
    { secret: true, redact: secrets },
  );
  return renderSet(
    pairs.map((p) => p.slice(0, p.indexOf("="))),
    resolved,
    skipDeploys,
  );
}

export function renderSet(
  names: string[],
  scope: Scope,
  skipDeploys: boolean,
): string {
  return renderOutput([
    encode({
      set: names,
      ...(scope.service ? { service: scope.service } : {}),
      ...(scope.environment ? { environment: scope.environment } : {}),
      redeploy: skipDeploys ? "skipped" : "triggered",
    }),
    renderHelp(
      skipDeploys
        ? [
            "The new values take effect on the next deploy of the service",
            "Run `railway-axi variables set <NAME=value>` without --skip-deploys on the last one to redeploy",
          ]
        : ["Run `railway-axi deployments` to watch the redeploy"],
    ),
  ]);
}
