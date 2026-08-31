import { assertNoArgs } from "../args.js";
import { railwayJson } from "../railway.js";
import { relativeTime, renderHelp, renderList, renderOutput } from "../toon.js";

export const LIST_HELP = `usage: railway-axi list
Lists all Railway projects in your account (name, workspace, env count, last update).
flags: none
examples:
  railway-axi list
`;

export interface RailwayProject {
  id: string;
  name: string;
  updatedAt: string | null;
  workspace?: { id: string; name: string };
  environments?: { edges?: { node: { name: string } }[] };
}

export async function listCommand(args: string[]): Promise<string> {
  assertNoArgs("list", args);
  const projects = await railwayJson<RailwayProject[]>(["list", "--json"]);

  if (projects.length === 0) {
    return "projects: 0 projects found in this account";
  }

  const rows = projects.map((p) => ({
    name: p.name,
    workspace: p.workspace?.name ?? "unknown",
    envs: p.environments?.edges?.length ?? 0,
    updated: relativeTime(p.updatedAt),
  }));

  return renderOutput([
    `count: ${projects.length} projects`,
    renderList("projects", rows),
    renderHelp([
      "Run `railway link -p <name>` in a project directory to link it",
      "Run `railway-axi status` to see the linked project",
    ]),
  ]);
}
