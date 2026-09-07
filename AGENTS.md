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
  rather than guess when several services could match.
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
- The SDK ships `update` as a reserved built-in, so `railway-axi update` works
  with no code here; the npm package name resolves from `package.json`.

## Conventions

- pnpm, Node >= 20, ES modules, TypeScript Node16 resolution
  (import specifiers end in `.js`), Vitest tests in `test/`.
- Conventional commit messages (`feat:`, `fix:`, `docs:`) with an eye toward
  release-please later.

## Maintaining this file

Keep entries concise and durable; point at the authoritative file rather than
restating what the code shows. Prefer rewriting or pruning over appending.
