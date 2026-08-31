import { assertNoArgs } from "../args.js";
import { railwayJson } from "../railway.js";
import { encode } from "../toon.js";

export const STATUS_HELP = `usage: railway-axi status
Shows the Railway project linked to the current directory: name, workspace, environments, services.
flags: none
examples:
  railway-axi status
`;

export interface RailwayStatus {
  id: string;
  name: string;
  workspace?: { name: string };
  environments?: { edges?: { node: { name: string } }[] };
  services?: { edges?: { node: { name: string } }[] };
}

function nodeNames(
  conn: { edges?: { node: { name: string } }[] } | undefined,
): string[] {
  return (conn?.edges ?? []).map((e) => e.node.name);
}

export async function statusCommand(args: string[]): Promise<string> {
  assertNoArgs("status", args);
  const status = await railwayJson<RailwayStatus>(["status", "--json"]);

  return encode({
    project: status.name,
    ...(status.workspace ? { workspace: status.workspace.name } : {}),
    environments: nodeNames(status.environments),
    services: nodeNames(status.services),
  });
}
