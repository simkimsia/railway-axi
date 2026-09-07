import { assertNoArgs, takeIntFlag } from "../args.js";
import {
  assertServiceUnambiguous,
  fetchServices,
  scopeArgs,
  takeScope,
  type Scope,
} from "../scope.js";
import { railwayJson } from "../railway.js";
import { relativeTime, renderHelp, renderList, renderOutput } from "../toon.js";

export const DEPLOYMENTS_LIMIT_DEFAULT = 20;
export const DEPLOYMENTS_LIMIT_MAX = 100;

export const DEPLOYMENTS_HELP = `usage: railway-axi deployments [flags]
Lists deployments of one service, newest first: id, status, age, reason, image or commit.
flags[4]:
  --service <name|id>   service to read; required when the environment has several and none is linked
  --project <name|id>   project to read (requires --environment); default: linked project
  --environment <name>  environment to read; default: linked environment
  --limit <n>           rows to return (default ${DEPLOYMENTS_LIMIT_DEFAULT}, max ${DEPLOYMENTS_LIMIT_MAX})
examples:
  railway-axi deployments
  railway-axi deployments --service web --limit 5
  railway-axi deployments --project my-app --environment production --service web
`;

export interface RailwayDeployment {
  id: string;
  status: string;
  createdAt: string | null;
  meta?: {
    reason?: string | null;
    image?: string | null;
    branch?: string | null;
    commitHash?: string | null;
    commitMessage?: string | null;
  } | null;
}

export async function deploymentsCommand(args: string[]): Promise<string> {
  const scope = takeScope(args);
  const limit = takeIntFlag(
    args,
    "--limit",
    DEPLOYMENTS_LIMIT_DEFAULT,
    DEPLOYMENTS_LIMIT_MAX,
  );
  assertNoArgs("deployments", args);

  // The raw CLI's output never names the service, so resolve it up front:
  // this both refuses ambiguity and lets the header say which service it is.
  const service = assertServiceUnambiguous(
    scope,
    await fetchServices(scope),
    "deployments",
  );
  const resolved: Scope = { ...scope, service };
  const deployments = await railwayJson<RailwayDeployment[]>([
    "deployment",
    "list",
    "--json",
    "--limit",
    String(limit),
    ...scopeArgs(resolved),
  ]);
  return renderDeployments(deployments, resolved);
}

function originOf(d: RailwayDeployment): string {
  const meta = d.meta ?? {};
  if (meta.image) return meta.image;
  if (meta.commitHash) {
    const sha = meta.commitHash.slice(0, 7);
    return meta.branch ? `${meta.branch}@${sha}` : sha;
  }
  if (meta.branch) return meta.branch;
  return "unknown";
}

export function renderDeployments(
  deployments: RailwayDeployment[],
  scope: Scope,
): string {
  const parts: string[] = [];
  if (scope.service) parts.push(`service: ${scope.service}`);
  if (scope.environment) parts.push(`env: ${scope.environment}`);
  const where = parts.length > 0 ? ` (${parts.join(", ")})` : "";

  if (deployments.length === 0) {
    return renderOutput([
      `deployments: 0 deployments${where}`,
      renderHelp([
        "Run `railway-axi services` to see which services have deployed",
      ]),
    ]);
  }
  const rows = deployments.map((d) => ({
    id: d.id,
    status: d.status,
    created: relativeTime(d.createdAt),
    reason: d.meta?.reason ?? "unknown",
    origin: originOf(d),
  }));
  return renderOutput([
    `count: ${deployments.length} deployments${where}`,
    renderList("deployments", rows),
    renderHelp([
      "Run `railway-axi logs <deployment-id>` for that deployment's logs",
      "Run `railway-axi logs --build <deployment-id>` for its build logs",
    ]),
  ]);
}
