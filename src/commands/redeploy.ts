import { assertNoArgs, takeBoolFlag } from "../args.js";
import { AxiError } from "../errors.js";
import { railwayJson } from "../railway.js";
import {
  resolveScope,
  scopeArgs,
  scopeHint,
  takeScope,
  type Scope,
} from "../scope.js";
import { encode, renderHelp, renderOutput } from "../toon.js";
import { originOf, type RailwayDeployment } from "./deployments.js";

export const REDEPLOY_HELP = `usage: railway-axi redeploy [flags]
Redeploys one service and prints the new deployment. Use it to apply variables set with \`variables set --skip-deploys\`.
By default the latest deployment is redeployed as-is (same image or commit); --from-source pulls the latest commit or image instead.
flags[4]:
  --service <name|id>   service to redeploy; required when the environment has several and none is linked
  --project <name|id>   project to use (requires --environment); default: linked project
  --environment <name>  environment to use; default: linked environment
  --from-source         deploy the latest commit or image from the configured source
examples:
  railway-axi redeploy --service web
  railway-axi redeploy --service web --environment production --from-source
  railway-axi redeploy --project my-app --environment production --service web
`;

/** `railway redeploy --json`: `{id}` for a redeploy, `{success}` for --from-source. */
interface RedeployResult {
  id?: string;
  success?: boolean;
}

/** Add a next step to the two refusals railway prints before redeploying. */
function explainRefusal(error: unknown, scope: Scope): unknown {
  if (!(error instanceof AxiError)) return error;
  const target = scopeHint(scope);
  if (/cannot be redeployed/i.test(error.message)) {
    return new AxiError(error.message, error.code, [
      `Run \`railway-axi deployments${target} --limit 1\` to see its status, and retry once it has finished`,
      `Or run \`railway-axi redeploy${target} --from-source\` to deploy from the source instead`,
    ]);
  }
  if (/no deployment found/i.test(error.message)) {
    return new AxiError(error.message, "NOT_FOUND", [
      `The service has never deployed; run \`railway-axi redeploy${target} --from-source\` to deploy its source`,
    ]);
  }
  return error;
}

export async function redeployCommand(args: string[]): Promise<string> {
  const scope = takeScope(args);
  const fromSource = takeBoolFlag(args, "--from-source");
  assertNoArgs("redeploy", args);

  const resolved = await resolveScope(scope, "redeploy");
  let result: RedeployResult;
  try {
    // --yes: the raw CLI otherwise prompts, and refuses outright without a TTY.
    result = await railwayJson<RedeployResult>([
      "redeploy",
      "--yes",
      "--json",
      ...(fromSource ? ["--from-source"] : []),
      ...scopeArgs(resolved),
    ]);
  } catch (error) {
    throw explainRefusal(error, resolved);
  }

  const deployment = result.id
    ? await findDeployment(result.id, resolved)
    : undefined;
  return renderRedeploy(result, resolved, fromSource, deployment);
}

/**
 * Best effort: the redeploy already happened, so a failed follow-up read must
 * not surface as an error an agent might answer by redeploying again.
 */
async function findDeployment(
  id: string,
  scope: Scope,
): Promise<RailwayDeployment | undefined> {
  try {
    const rows = await railwayJson<RailwayDeployment[]>([
      "deployment",
      "list",
      "--json",
      "--limit",
      "5",
      ...scopeArgs(scope),
    ]);
    return rows.find((d) => d.id === id);
  } catch {
    return undefined;
  }
}

export function renderRedeploy(
  result: RedeployResult,
  scope: Scope,
  fromSource: boolean,
  deployment?: RailwayDeployment,
): string {
  const target = scopeHint(scope);
  const body = {
    redeploy: {
      ...(scope.service ? { service: scope.service } : {}),
      ...(scope.environment ? { environment: scope.environment } : {}),
      mode: fromSource ? "from-source" : "latest",
      ...(result.id ? { deployment: result.id } : {}),
      status: deployment?.status ?? "triggered",
      ...(deployment ? { origin: originOf(deployment) } : {}),
    },
  };
  const help = [
    `Run \`railway-axi deployments${target} --limit 1\` to watch its status`,
    result.id
      ? `Run \`railway-axi logs --build ${result.id}${target}\` for its build logs`
      : `Run \`railway-axi logs --build <deployment-id>${target}\` for its build logs`,
  ];
  return renderOutput([encode(body), renderHelp(help)]);
}
