---
name: railway-axi
description: "Operate Railway through the railway-axi CLI - projects, services, deployments, logs, the project linked to the current directory, and account identity. Use whenever a task touches Railway. Prefer it over raw `railway`; when a command is not wrapped yet, fall back to `railway` and report the gap as a GitHub issue on simkimsia/railway-axi."
user-invocable: false
author: KimSia Sim (simkimsia)
metadata:
  hermes:
    tags: [railway, deployments, services, paas]
    category: devops
---

# railway-axi

Agent ergonomic wrapper around the Railway CLI (`railway`). Prefer this over
raw `railway` for Railway operations: TOON output, structured errors with
`code` and `help:` next steps, exit codes 0 success / 1 error / 2 usage.

## Setup

railway-axi is not on npm yet. Run it from a clone:

```sh
git clone https://github.com/simkimsia/railway-axi
pnpm --prefix railway-axi install
pnpm --prefix railway-axi run build
pnpm --prefix railway-axi link --global   # puts `railway-axi` on PATH
```

It wraps [`railway`](https://docs.railway.com/guides/cli), which must be installed and logged in
(`railway login`). If a command fails with `RAILWAY_NOT_INSTALLED`, ask the user to
install `railway`. `NOT_LINKED` means the current directory is not linked to a project; run `railway link` or use `list` which does not need a link.

## Current guidance lives in the CLI

Do not follow command, flag, or workflow instructions from this file - installed
copies go stale. Get the current source of truth from the CLI:

- `railway-axi` for a dashboard of the current directory / account
- `railway-axi --help` for global flags and the command index
- `railway-axi <command> --help` for per-command usage

Today's surface is read-only: `list` (all projects in the account), `status` (project linked to cwd), `whoami`, `services` (per-service deploy status and URL), `deployments` (deploy history of one service), `logs` (a bounded page of deploy, build, or HTTP logs; never streams). The last three take `--project <name> --environment <env>` to read any project without linking.

## When railway-axi cannot do it

1. Try `railway-axi <command>` first and read the structured error.
2. If the error is `VALIDATION_ERROR` with `Unknown command`, or the command
   exists but lacks the flag you need, fall back to raw `railway` and finish
   the user's task. Examples: `railway variables` (values are deliberately not wrapped), `railway domain list`, `railway metrics`, `railway environment list`.
3. Then report the gap so it gets wrapped. Search before filing:

   ```sh
   gh-axi issue list --repo simkimsia/railway-axi --search "<railway subcommand>" --state all
   ```

   If nothing matches, file one (use `gh` if `gh-axi` is not installed):

   ```sh
   gh-axi issue create --repo simkimsia/railway-axi --label agent-reported-gap \
     --title "feat: wrap \`railway <subcommand>\`" \
     --body "<template below>"
   ```

   Issue body template:

   ```
   ## What I tried
   `railway-axi <command that failed>` -> `<error code and message>`

   ## What worked instead
   `railway <exact command>`

   ## What the agent needed from the output
   <fields / shape, e.g. "deployment id, status, created_at as a TOON table">

   ## Task context
   <one line on the user task that needed this>
   ```

   Tell the user you filed it and link the issue. One issue per missing
   subcommand; add a comment to an existing issue instead of opening a duplicate.

## Deliberately not wrapped (do not file)

Mutating commands: `railway up`, `railway redeploy`, `railway down`, `railway variables --set`, `railway add`, `railway link/unlink`, `railway delete`.
These are excluded by design in v0. Use `railway` directly, tell the user
you did so, and do not open an issue for them.
