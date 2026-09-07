import { assertNoArgs } from "../args.js";
import {
  fetchServices,
  takeScope,
  type RailwayService,
  type Scope,
} from "../scope.js";
import { relativeTime, renderHelp, renderList, renderOutput } from "../toon.js";

export const SERVICES_HELP = `usage: railway-axi services [flags]
Lists services in an environment: latest deployment status, age, source, public URL.
flags[2]:
  --project <name|id>   project to read (requires --environment); default: linked project
  --environment <name>  environment to read; default: linked environment
examples:
  railway-axi services
  railway-axi services --project my-app --environment production
`;

export async function servicesCommand(args: string[]): Promise<string> {
  const scope = takeScope(args);
  assertNoArgs("services", args);
  const services = await fetchServices(scope);
  return renderServices(services, scope);
}

function sourceOf(service: RailwayService): string {
  const src = service.source;
  if (src?.image) return src.image;
  if (src?.repo) return src.repo;
  return "none";
}

export function renderServices(
  services: RailwayService[],
  scope: Scope,
): string {
  const where = scope.environment
    ? ` in ${scope.environment}`
    : " in the linked environment";
  if (services.length === 0) {
    return renderOutput([
      `services: 0 services${where}`,
      renderHelp(["Run `railway-axi status` to see environments and services"]),
    ]);
  }
  const rows = services.map((s) => ({
    name: s.name,
    status: s.latestDeployment?.status ?? s.status ?? "none",
    deployed: relativeTime(s.latestDeployment?.createdAt),
    source: sourceOf(s),
    url: s.url ?? "none",
    volumes: s.volumes?.length ?? 0,
  }));
  return renderOutput([
    `count: ${services.length} services${where}`,
    renderList("services", rows),
    renderHelp([
      "Run `railway-axi deployments --service <name>` for deploy history",
      "Run `railway-axi logs --service <name>` for recent log lines",
    ]),
  ]);
}
