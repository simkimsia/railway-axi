# Project agent memory

Project-intrinsic knowledge for agents working on railway-axi.

## What this is

An AXI-compliant wrapper around the Railway CLI, built on `axi-sdk-js`
(`runAxiCli` in `src/cli.ts`) and deliberately modeled on the reference
implementation [gh-axi](https://github.com/kunchenguid/gh-axi). When adding a
capability, check how gh-axi solved the analogous problem first, and follow the
AXI principles (the `axi` skill in the upstream `kunchenguid/axi` repo).

## Architecture

- `bin/railway-axi.ts` — entrypoint; answers bare `-v`/`-V`/`--version` via
  `axi-sdk-js/fast-path` before dynamically importing `src/cli.ts`.
  `src/version.ts` must stay a LEAF module (node builtins only) or the fast
  path silently stops being fast.
- `src/railway.ts` — sole place that spawns the `railway` binary
  (`railwayJson` / `railwayNdjson` / `railwayExec`). Non-zero exits route
  through `mapRailwayError`; a missing binary maps to `RAILWAY_NOT_INSTALLED`.
  Also owns project name-to-id resolution (`resolveProjectId`).
- `src/errors.ts` — `mapRailwayError` walks `patterns` in order and returns on
  the first regex hit, so order is the contract: narrow patterns before broad
  ones (same rule as gh-axi's `mapGhError`). Verify new patterns against real
  railway stderr before adding them.
- `src/args.ts` — commands pull the flags they know with the `take*`
  helpers, then `assertNoArgs` rejects whatever is left by name with exit
  code 2 before any railway call (AXI §6). A flag is never accepted silently.
- `src/scope.ts` — the shared `--project`/`--environment`/`--service` flags
  (`takeScope`, `scopeArgs`) and service resolution for `deployments` and
  `logs` (`fetchServices`, `assertServiceUnambiguous`): refuse and list names
  rather than guess when several services could match. `scopeHint` renders
  the scope for printed next-step commands, shell-quoted so a copy still runs.
- Commands live in `src/commands/`, return TOON strings via `src/toon.ts`
  helpers; errors render through the `formatError` hook in `src/cli.ts`
  because the SDK's default formatter only recognizes its own AxiError class.

## Railway CLI notes

- `railway list --json` and `railway status --json` return GraphQL-shaped
  objects (`environments.edges[].node`); `railway whoami` is text-only and is
  parsed by `parseWhoami` in `src/commands/whoami.ts` with a raw-line fallback.
- `railway status` is directory-scoped (linked project); `list` is
  account-scoped.
- `railway logs --json` emits NDJSON, not an array (`parseNdjson` in
  `src/railway.ts`). `railway service list` accepts a project id only, while
  `deployment list` and `logs` accept a name; `--project` always needs
  `--environment`. See the comments in `src/scope.ts`.
- `railway variable list --json` is a flat `{NAME: value}` object of raw
  secrets, and `variable` takes a project id only. `src/commands/variables.ts`
  handles secret values; no code path there may print a value other
  than the single one `get` was asked for (errors included). Its railway calls
  pass `secret`/`redact` (`SecretOptions` in `src/railway.ts`), and
  `test/variables-leak.test.ts` fakes the binary to prove it. Errors are
  masked through `secretCandidates`, an allowlist: a new flag or subcommand
  must be added to it (`KNOWN_FLAGS`/`SUBCOMMANDS`) and to the sweep's
  `BASES`, and a new railway failure mode gets a row in the cases table.
- `railway redeploy` takes a project id only and prompts unless `--yes`
  (refusing outright without a TTY). `--json` prints `{"id": <new deployment>}`,
  or only `{"success": true}` with `--from-source`, so `src/commands/redeploy.ts`
  looks the id up in `deployment list` best effort and never fails after the
  redeploy itself succeeded.
- `railway ssh [scope] -- <cmd>` hands the words to a shell on the remote
  side. `src/commands/ssh.ts` runs only its `ALLOWED` commands and validates
  the whole joined line (`SAFE_LINE` charset, `SENSITIVE` paths, per-command
  flag rules) before any railway call; widen the allowlist only for commands
  that cannot print environment values or change state. Its railway call uses
  `railwayRun`, which returns non-zero exits as output (they belong to the
  remote command) with a timeout and stdin closed.
- `src/scope.ts` `resolveScope` is the shared project-id + single-service
  resolution for commands whose railway subcommand takes a project id only.
- The SDK ships `update` as a reserved built-in, so `railway-axi update` works
  with no code here; the npm package name resolves from `package.json`.

## Conventions

- pnpm, Node >= 20, ES modules, TypeScript Node16 resolution
  (import specifiers end in `.js`), Vitest tests in `test/`.
- Conventional commit messages (`feat:`, `fix:`, `docs:`). Releases are cut by
  release-please from those commits and published to npm by trusted publishing.

## Maintaining this file

Keep entries concise and durable; point at the authoritative file rather than
restating what the code shows. Prefer rewriting or pruning over appending.
