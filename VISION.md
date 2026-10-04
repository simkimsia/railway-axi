# Vision

`railway-axi` is an agent-ergonomic interface to Railway. It wraps the official CLI, `railway`, first, and calls Railway's public GraphQL API, through `railway api`, only where the other `railway` commands have no surface or their output costs the agent extra calls.

## Scope

We aim for functional parity with `railway` on the surfaces agents operate: projects, services, deployments, logs, variables, and account identity.
Every capability available through `railway` should eventually be accessible through an AXI-native interface.

A command may use the public GraphQL API through `railway api` when no other `railway` command has the surface, or when one query replaces several CLI calls per row.
Every Railway call reuses the session `railway login` already holds; we do not add separate token management.
We do not call Railway's MCP server; its tools are reached through `railway` or `railway api`.
Every MCP tool maps to an existing CLI command or public API operation, and keeping the MCP server out keeps it a separate arm in `bench/`.

The `bench/` directory, which will measure railway-axi against the raw `railway` CLI and Railway's MCP server, is in scope and does not ship in the published package.

We accept contributions that expose existing Railway capabilities more ergonomically.
We do not add functionality that Railway itself does not provide, and we do not embed workflow logic that belongs in the calling agent.

## Interface

The interface must follow validated AXI principles and optimize for autonomous agent use.
These interface rules apply to commands; the `bench/` harness is not a command surface.

Output may be structured, but its structure exists for agent comprehension rather than as a stable API for imperative programs.
Human-oriented presentation and compatibility work primarily serving hand-written parsers are not goals.

Errors carry a stable code and a next step the agent can act on.
An unknown flag or argument is rejected by name before any `railway` call; it is never accepted silently.
The wrapper may reshape, combine, or simplify `railway` and API operations when doing so improves agent ergonomics without expanding the underlying capability.

## Safety

Read commands are the default and never change project state.
Write commands are explicit, named as verbs, and print what changed, including any redeploy they trigger.
A command that deletes or overwrites requires the target to be named in full.
When several services could match and none is named with a flag or linked to the current directory, the command refuses and lists the names; it never guesses.
Variable values are printed only by a command that names one variable, and never appear in lists, errors, or logs.
