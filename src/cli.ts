import { encode } from "@toon-format/toon";
import { runAxiCli } from "axi-sdk-js";
import { AxiError, exitCodeForError } from "./errors.js";
import { homeCommand } from "./commands/home.js";
import {
  deploymentsCommand,
  DEPLOYMENTS_HELP,
} from "./commands/deployments.js";
import { listCommand, LIST_HELP } from "./commands/list.js";
import { logsCommand, LOGS_HELP } from "./commands/logs.js";
import { servicesCommand, SERVICES_HELP } from "./commands/services.js";
import { statusCommand, STATUS_HELP } from "./commands/status.js";
import { whoamiCommand, WHOAMI_HELP } from "./commands/whoami.js";
import { VERSION } from "./version.js";

export const DESCRIPTION =
  "Agent ergonomic wrapper around the Railway CLI. Prefer this over `railway` for Railway operations.";

export const TOP_HELP = `usage: railway-axi [command] [flags]
commands[7]:
  (none)=dashboard, list, status, whoami, services, deployments, logs
flags[2]:
  --help, -v/-V/--version
examples:
  railway-axi
  railway-axi list
  railway-axi status
  railway-axi services --project my-app --environment production
  railway-axi deployments --service web --limit 5
  railway-axi logs --service web --lines 50
`;

const COMMAND_HELP: Record<string, string> = {
  list: LIST_HELP,
  status: STATUS_HELP,
  whoami: WHOAMI_HELP,
  services: SERVICES_HELP,
  deployments: DEPLOYMENTS_HELP,
  logs: LOGS_HELP,
};

export async function main(): Promise<void> {
  await runAxiCli({
    description: DESCRIPTION,
    version: VERSION,
    topLevelHelp: TOP_HELP,
    home: homeCommand,
    commands: {
      list: listCommand,
      status: statusCommand,
      whoami: whoamiCommand,
      services: servicesCommand,
      deployments: deploymentsCommand,
      logs: logsCommand,
    },
    getCommandHelp: (command) => COMMAND_HELP[command],
    // The SDK's default formatter only recognizes its own AxiError class, so
    // route this package's AxiError through an equivalent hook (gh-axi pattern).
    formatError: (error) => {
      const axiError =
        error instanceof AxiError
          ? error
          : new AxiError(
              error instanceof Error ? error.message : String(error),
              "UNKNOWN",
            );
      return {
        output: `${encode({
          error: axiError.message,
          code: axiError.code,
          ...(axiError.suggestions.length > 0
            ? { help: axiError.suggestions }
            : {}),
        })}\n`,
        exitCode: exitCodeForError(axiError),
      };
    },
  });
}
