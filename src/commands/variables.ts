import { assertNoArgs, takeBoolFlag, takePositional } from "../args.js";
import { AxiError } from "../errors.js";
import { railwayExec, railwayJson, resolveProjectId } from "../railway.js";
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

export async function variablesCommand(args: string[]): Promise<string> {
  // A bare `variables` (or one that starts with a flag) lists, the safe read.
  const sub =
    args[0] === undefined || args[0].startsWith("-") ? "list" : args.shift()!;
  switch (sub) {
    case "list":
      return listVariables(args);
    case "get":
      return getVariable(args);
    case "set":
      return setVariables(args);
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

function fetchVariables(scope: Scope): Promise<Record<string, string>> {
  return railwayJson<Record<string, string>>(
    ["variable", "list", "--json", ...scopeArgs(scope)],
    { secret: true },
  );
}

function where(scope: Scope): string {
  const parts: string[] = [];
  if (scope.service) parts.push(`service: ${scope.service}`);
  if (scope.environment) parts.push(`env: ${scope.environment}`);
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

async function listVariables(args: string[]): Promise<string> {
  const scope = takeScope(args);
  assertNoArgs("variables list", args);
  const resolved = await resolveScope(scope, "variables list");
  return renderVariableNames(await fetchVariables(resolved), resolved);
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

async function getVariable(args: string[]): Promise<string> {
  const scope = takeScope(args);
  const name = takePositional(args);
  if (name === undefined) {
    throw new AxiError(
      "`variables get` requires a variable name",
      "VALIDATION_ERROR",
      ["Run `railway-axi variables get <NAME> [--service <name>]`"],
    );
  }
  assertNoArgs("variables get", args);
  const resolved = await resolveScope(scope, "variables get");
  return renderVariable(name, await fetchVariables(resolved), resolved);
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

// Railway splits each pair on the first `=`, so only the name is constrained.
const PAIR_RE = /^[^\s=]+=/;

async function setVariables(args: string[]): Promise<string> {
  const original = [...args];
  const scope = takeScope(args);
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
  const bad = pairs.find((p) => p.startsWith("-") || !PAIR_RE.test(p));
  if (bad !== undefined) {
    throw new AxiError(
      `argument ${original.indexOf(bad) + 1} of \`variables set\` is not NAME=value or a known flag (not shown: it may be a value)`,
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
    { secret: true, redact: pairs.map((p) => p.slice(p.indexOf("=") + 1)) },
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
