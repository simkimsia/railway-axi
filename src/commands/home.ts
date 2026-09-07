import { railwayJson } from "../railway.js";
import {
  encode,
  relativeTime,
  renderHelp,
  renderList,
  renderOutput,
} from "../toon.js";
import type { RailwayProject } from "./list.js";
import type { RailwayStatus } from "./status.js";

const HOME_PROJECT_LIMIT = 3;

export async function homeCommand(): Promise<string> {
  // Content first (AXI §8): show the linked project if there is one,
  // otherwise the most recent projects — never a usage manual.
  const linked = await railwayJson<RailwayStatus>(["status", "--json"]).catch(
    () => undefined,
  );

  if (linked) {
    return renderOutput([
      encode({
        project: linked.name,
        environments: (linked.environments?.edges ?? []).map(
          (e) => e.node.name,
        ),
        services: (linked.services?.edges ?? []).map((e) => e.node.name),
      }),
      renderHelp([
        "Run `railway-axi status` for linked project details",
        "Run `railway-axi list` for all projects",
      ]),
    ]);
  }

  const projects = await railwayJson<RailwayProject[]>([
    "list",
    "--json",
  ]).catch(() => [] as RailwayProject[]);

  const blocks: string[] = ["project: none linked to this directory"];
  const hints: string[] = [];

  if (projects.length === 0) {
    blocks.push("projects: 0 projects found in this account");
  } else {
    const rows = projects.slice(0, HOME_PROJECT_LIMIT).map((p) => ({
      name: p.name,
      updated: relativeTime(p.updatedAt),
    }));
    blocks.push(renderList("projects", rows));
    if (projects.length > HOME_PROJECT_LIMIT) {
      hints.push(
        `Run \`railway-axi list\` for all ${projects.length} projects`,
      );
    }
  }

  hints.push("Run `railway link -p <name>` to link a project here");
  blocks.push(renderHelp(hints));
  return renderOutput(blocks);
}
