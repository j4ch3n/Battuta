# Antigravity setup

CoS runs its default model, `antigravity-acp/gemini-4-neon`, through
`pi-agy-acp@0.2.4`. The extension uses the official Antigravity CLI (`agy`) and the
host's Google login, not a Gemini API key. It is installed by the normal CoS setup
because it is listed in the CoS manifest's `[packages] pi`.

## Prerequisites

- The [Antigravity CLI](https://antigravity.google/docs/ide/extensions/acp/) 1.5.18 or
  later on the bot host's `PATH`.
- A Google account with Neon access, signed in by the host operator by running `agy`
  interactively. This is a private credential: keep it out of releases.

## First launch: refresh the model catalog

A fresh install has no `antigravity-acp` models until the catalog is refreshed, and
launchers pass `--model` on every start. Before CoS's first launch, start CoS's agent with
only this extension loaded:

```sh
pnpm --dir bots/cos-bot exec pi --approve --no-extensions --no-session \
  -e ./.pi/npm/node_modules/pi-agy-acp/index.ts
```

Run `/agy-acp refresh`, confirm `/model` lists `antigravity-acp/gemini-4-neon`, then exit
without sending a message. Refreshing does not call a model.

## Installation checks: no model calls

```sh
command -v agy && agy --version
test -f bots/cos-bot/.pi/npm/node_modules/pi-agy-acp/package.json
```

For releases, inspect the installation. Missing output means setup is incomplete; stop
rather than starting CoS.

## Separate manual functional check

Start CoS and confirm Neon answers a short message and completes a harmless tool call.
Run one CoS per host; concurrent CoS instances need separate `PI_AGY_HOME` directories.
