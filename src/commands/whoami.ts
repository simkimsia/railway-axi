import { assertNoArgs } from "../args.js";
import { railwayExec } from "../railway.js";
import { encode } from "../toon.js";

export const WHOAMI_HELP = `usage: railway-axi whoami
Shows the Railway account you are logged in as.
flags: none
examples:
  railway-axi whoami
`;

export async function whoamiCommand(args: string[]): Promise<string> {
  assertNoArgs("whoami", args);
  const raw = (await railwayExec(["whoami"])).trim();
  return encode(parseWhoami(raw));
}

/** Parse `railway whoami` text ("Logged in as Jane Doe (jane@x.com) 👋"). */
export function parseWhoami(
  raw: string,
): { user: { name: string; email: string } } | { user: string } {
  const match = /Logged in as (.+?) \(([^)]+)\)/.exec(raw);
  if (match) {
    return { user: { name: match[1], email: match[2] } };
  }
  return { user: raw };
}
