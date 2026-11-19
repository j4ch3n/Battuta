# Claude DirectSDK setup

Every bot (CoS, Manager, Workers including Influencer) runs its default model through
`pi-claude-directsdk@1.0.2`, which uses the Claude Agent SDK and the host's Claude Code
login instead of Pi's `anthropic` provider. Models use the `claude-directsdk/<model-id>`
form in each manifest's `[defaults] model`. The package is installed by the normal bot
setup because it is listed in each manifest's `[packages] pi`.

## Prerequisites

- Node 20 or later and the `claude` binary on the bot host's `PATH`.
- A Claude paid plan, signed in by the host operator with `claude auth login`. This is a
  private credential: keep it out of releases.
- None of `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_BASE_URL` set in the
  bot's environment; the extension refuses to start a session when they are present.

## First launch: refresh the model catalog

A fresh install has no `claude-directsdk` models until an interactive Pi session refreshes
the catalog, and launchers pass `--model` on every start. Before the first launch of a bot
(or a host's first bot), start Pi interactively with that bot's agent directory, open
`/model` and wait for "Model catalogs refreshed". Until then launch fails with
`Model "claude-directsdk/<id>" not found`. The snapshot is kept in the agent directory.

## Installation checks: no model calls

```sh
command -v claude && claude --version
claude auth status
test -f bots/cos-bot/.pi/npm/node_modules/pi-claude-directsdk/package.json
```

Repeat the last check for each bot directory you run (for example `bots/manager-bot`,
`bots/worker`, `bots/worker-influencer`); for releases, inspect the installation. Missing
output means setup is incomplete; stop rather than starting bots.

## Separate manual functional check

Start a bot, open `/model` and wait for the DirectSDK catalog refresh, then confirm the
manifest's model is listed and answers a short message. Models that need usage credits can
incur separate charges; see the extension's usage-credit guard.
