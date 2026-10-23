# railway-axi

An [AXI](https://axi.md)-compliant wrapper around the [Railway](https://railway.com) CLI —
token-efficient [TOON](https://toonformat.dev) output, structured errors, and
agent-first ergonomics for AI coding agents that operate Railway via shell.

Built on [`axi-sdk-js`](https://github.com/kunchenguid/axi), modeled on the
reference implementation [`gh-axi`](https://github.com/kunchenguid/gh-axi).

## Status

Early scaffold (v0). Read-only commands, plus two mutating ones:
`variables set` and `redeploy`.

## Requirements

- Node.js >= 20
- The [Railway CLI](https://docs.railway.com/guides/cli) installed and logged in
  (`railway login`)

## Install

```sh
pnpm add -g @simkimsia/railway-axi
```

Or run it without installing: `npx -y @simkimsia/railway-axi --help`.

Check it: `railway-axi --version`. Update later with `railway-axi update`.

To work on it from a clone:

```sh
git clone https://github.com/simkimsia/railway-axi
pnpm -C railway-axi install
pnpm -C railway-axi run build
pnpm add -g link:$PWD/railway-axi   # puts `railway-axi` on PATH
```

## Usage

```sh
railway-axi            # dashboard: linked project, or recent projects
railway-axi list       # all projects in your account
railway-axi status     # project linked to the current directory
railway-axi whoami     # logged-in Railway account
railway-axi services     [--project <name> --environment <env>]   # services: status, age, source, URL
railway-axi deployments  [--service <name>] [--limit 20]           # deploy history of one service
railway-axi logs         [deployment-id] [--lines 100] [--build|--http] [--filter "@level:error"] [--fields a,b]
railway-axi variables list [--service <name>]                     # variable names only, never values
railway-axi variables get <NAME> [--service <name>]               # one value
railway-axi variables set <NAME=value>... [--skip-deploys]        # set; redeploys unless --skip-deploys
railway-axi redeploy     [--service <name>] [--from-source]        # redeploy latest deployment, or deploy latest source
railway-axi ssh          [--service <name>] [--lines 100] -- <cmd>  # one allowlisted read-only command in the container
railway-axi --help
railway-axi --version  # fast path, never loads the command graph
railway-axi update     # self-update (built into axi-sdk-js)
```

Example output (TOON):

```
count: 12 projects
projects[12]{name,workspace,envs,updated}:
  my-app,Acme,2,3d ago
  ...
help[2]:
  Run `railway link -p <name>` in a project directory to link it
  Run `railway-axi status` to see the linked project
```

`services`, `deployments`, `logs`, `variables`, `redeploy` and `ssh` default to the project linked
to the current directory (or a parent). Pass `--project <name|id> --environment <env>`
to target any project without linking. `logs` always fetches a bounded page and
exits; it never streams, so an agent can never hang on it. When an environment
has several services and none is linked, `deployments`, `logs`, `variables`, `redeploy` and `ssh`
refuse and list the names instead of guessing.

Variable values are secrets, so `variables list` prints names only, `get`
prints the one value asked for, and `set` reports the names it set and whether
a redeploy was triggered without echoing any value. To apply several
`--skip-deploys` sets at once, run `redeploy`: it redeploys the latest
deployment as-is (or the latest source with `--from-source`) and prints the
new deployment id and status.

`ssh` runs one read-only command in a running service container and exits:
`railway-axi ssh --service web -- ps aux`. Only an allowlist runs (`ls`, `cat`,
`head`, `tail`, `wc`, `stat`, `du`, `df`, `ps`, `id`, `uname`, `uptime`,
`free`, `date`, `pwd`, `whoami`, `hostname`), and the whole line is checked
before any railway call: shell operators, quotes, globs and substitutions are
refused (one command per call), as are `env`/`printenv` and paths that hold
secrets such as `/proc/*/environ`, `.env`, `.envrc` and `/run/secrets` (run
`variables list` for names). File commands (`ls`, `cat`, `head`, `tail`, `wc`,
`stat`, `du`, and path-reading options such as `date -f`/`-r`) accept only
absolute paths in the following trees or single-file set: `/app`,
`/var/log` and `/sys/fs/cgroup`, plus `/etc/os-release`, a few system-wide
`/proc` files (`meminfo`, `loadavg`, `uptime`, `cpuinfo`, `version`) and
`/proc/<pid>/{cmdline,status,stat,statm,limits}` (`<pid>` is digits or `self`).
Relative paths and bare `ls`/`du` are refused because the container's working
directory is unknown (run `railway-axi ssh -- pwd` first). Any `..` path
component is refused, even within an allowed tree, because symlinks can make
it escape that tree. `-` is accepted as stdin only for `cat`, `head`, `tail`,
`wc` operands and `date -f`/`--file`; stdin is closed. The `du` and `wc` option
`--files0-from`, including abbreviations, is refused because the filenames
inside its list cannot be checked; name paths directly instead.

These checks constrain path spellings, not resolved symlink targets: a symlink
or an innocently named credential file under `/app` remains an accepted risk.
Railway injects variables as environment values, not files. `/tmp` is excluded
because apps may write credentials there; the `/proc` tree is excluded because
its process links and memory files can expose other files or secrets. For
paths outside the allowlist, use plain `railway ssh`. stdout is capped at
`--lines` (default 100) and each line at 300 characters.

Set `AXI_DEBUG=1` to print each `railway` argv the axi forwards on stderr, one
line per call, ready to rerun against the plain CLI. Values passed to
`variables set` are masked. stdout is unchanged.

## Agent skill

Install the bundled skill so your coding agent prefers `railway-axi` over raw
`railway`, falls back to `railway` when a command is not wrapped yet, and
files the gap as an issue here (label `agent-reported-gap`):

```sh
npx skills add simkimsia/railway-axi --skill railway-axi -g
```

The skill is a discovery stub that defers to `railway-axi --help` for current
command guidance. Source: [`skills/railway-axi/SKILL.md`](skills/railway-axi/SKILL.md).

## Development

```sh
pnpm install
pnpm run dev          # run from source (tsx)
pnpm test             # vitest
pnpm run build        # tsc -> dist/
pnpm run format:check
```

## Changelog

Release notes live in [CHANGELOG.md](CHANGELOG.md) and on [GitHub Releases](https://github.com/simkimsia/railway-axi/releases).
release-please writes both from conventional commits, so do not edit the file by hand.
Breaking changes, such as a renamed error code, are listed under "⚠ BREAKING CHANGES" and bump the minor version while below 1.0.

## License

MIT
