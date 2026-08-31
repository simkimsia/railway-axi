# railway-axi

An [AXI](https://axi.md)-compliant wrapper around the [Railway](https://railway.com) CLI —
token-efficient [TOON](https://toonformat.dev) output, structured errors, and
agent-first ergonomics for AI coding agents that operate Railway via shell.

Built on [`axi-sdk-js`](https://github.com/kunchenguid/axi), modeled on the
reference implementation [`gh-axi`](https://github.com/kunchenguid/gh-axi).

## Status

Early scaffold (v0). Read-only commands only.

## Requirements

- Node.js >= 20
- The [Railway CLI](https://docs.railway.com/guides/cli) installed and logged in
  (`railway login`)

## Usage

```sh
railway-axi            # dashboard: linked project, or recent projects
railway-axi list       # all projects in your account
railway-axi status     # project linked to the current directory
railway-axi whoami     # logged-in Railway account
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

## Development

```sh
pnpm install
pnpm run dev          # run from source (tsx)
pnpm test             # vitest
pnpm run build        # tsc -> dist/
pnpm run format:check
```

## License

MIT
