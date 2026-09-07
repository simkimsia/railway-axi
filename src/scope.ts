import { takeFlag } from "./args.js";
import { AxiError } from "./errors.js";
import { railwayJson, resolveProjectId } from "./railway.js";

/**
 * The three flags every read command shares. All optional: when absent,
 * railway falls back to the project/environment/service linked to cwd
 * (walking up parent directories), exactly as the raw CLI does.
 */
export interface Scope {
  project?: string;
  environment?: string;
  service?: string;
}

export function takeScope(args: string[]): Scope {
  const scope: Scope = {
    project: takeFlag(args, "--project"),
    environment: takeFlag(args, "--environment"),
    service: takeFlag(args, "--service"),
  };
  if (scope.project !== undefined && scope.environment === undefined) {
    throw new AxiError(
      "--environment is required when --project is given",
      "VALIDATION_ERROR",
      [
        "Add `--environment <name>` (for example `production`)",
        "Run `railway-axi status` to see environment names of the linked project",
      ],
    );
  }
  return scope;
}

/**
 * Translate a scope into the argv fragment the raw CLI expects. Values go in
 * `--flag=value` form because railway's clap parser rejects a dash-leading
 * value in the space form, and that form is the escape hatch takeFlag offers.
 */
export function scopeArgs(scope: Scope): string[] {
  const out: string[] = [];
  if (scope.project) out.push(`--project=${scope.project}`);
  if (scope.environment) out.push(`--environment=${scope.environment}`);
  if (scope.service) out.push(`--service=${scope.service}`);
  return out;
}

export interface RailwayService {
  id: string;
  name: string;
  isLinked?: boolean;
  status?: string | null;
  source?: { repo?: string | null; image?: string | null } | null;
  latestDeployment?: {
    id: string;
    status: string;
    createdAt: string | null;
  } | null;
  url?: string | null;
  volumes?: unknown[];
  regions?: unknown[];
}

/**
 * `railway service list --json` for the scope. Resolves a project name to its
 * id first because this one subcommand rejects names.
 */
export async function fetchServices(scope: Scope): Promise<RailwayService[]> {
  const args = ["service", "list", "--json"];
  if (scope.project) {
    args.push(`--project=${await resolveProjectId(scope.project)}`);
  }
  if (scope.environment) args.push(`--environment=${scope.environment}`);
  try {
    return await railwayJson<RailwayService[]>(args);
  } catch (error) {
    // For a bad explicit id railway prints the same "Project not found. Run
    // `railway link`" text as an unlinked directory; with --project given,
    // "not linked" is never the true story.
    if (
      scope.project &&
      error instanceof AxiError &&
      error.code === "NOT_LINKED"
    ) {
      throw new AxiError(`Project "${scope.project}" not found`, "NOT_FOUND", [
        "Run `railway-axi list` to see available projects",
      ]);
    }
    throw error;
  }
}

/**
 * Deployments and logs silently pick a service when the environment has one,
 * and the linked service when cwd has one. With several services and no
 * explicit or linked choice, refuse rather than guess (AXI §6).
 */
export function assertServiceUnambiguous(
  scope: Scope,
  services: RailwayService[],
  command: string,
): string | undefined {
  if (scope.service) return scope.service;
  if (services.length <= 1) return services[0]?.name;
  const linked = services.find((s) => s.isLinked);
  if (linked && !scope.project) return linked.name;
  throw new AxiError(
    `Environment has ${services.length} services; pass --service to choose one`,
    "VALIDATION_ERROR",
    [
      `Services: ${services.map((s) => s.name).join(", ")}`,
      `Run \`railway-axi ${command} --service <name>\``,
    ],
  );
}
