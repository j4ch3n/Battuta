# Antigravity setup

CoS defaults to `antigravity-acp/gemini-4-neon` through the pinned
`pi-agy-acp@0.2.4` package. It runs the official Antigravity
CLI's `agy acp` server using the host operator's Google login, not Gemini CLI
or a Gemini API key. Pi retains conversation history, tool execution and
approvals. Claude remains installed; other bots' defaults are unchanged.

## Prerequisites and installation

- Use Battuta's pinned Node and Pi versions. The bridge requires Node 22.19+
  and targets Pi 1.5.x. Extension loading has also been checked on Battuta's
  pinned Pi 1.6.1; live behavior still needs manual acceptance.
- Install the official [Antigravity CLI](https://antigravity.google/docs/ide/extensions/acp/)
  on the bot host's `PATH`. The bridge requires agy 1.5.18+.
- The host operator must run `agy` interactively and sign in with a Google
  account that offers Neon. Keep login data private and out of releases.
  The bridge uses CLI authentication and strips Gemini API-key environment
  variables from its subprocesses.

Normal CoS setup installs the manifest's pinned bridge: `make setup-cos-bot`
for a configured source checkout, or the release's normal `install-runtime`
step. No separate global Pi extension installation is needed. Setup does not
authenticate, restart a running bot or verify account model access.

## Installation checks: no model calls

From the checkout or release root, run:

```sh
set -eu
command -v agy
agy --version
agy acp --help
node --version
pnpm --dir bots/cos-bot exec pi --version
test -f bots/cos-bot/.pi/npm/node_modules/pi-agy-acp/package.json
```

Expect agy 1.5.18+, a help page with ACP options, Battuta's pinned Node/Pi
versions and an installed bridge package. Stop if a command fails or a
prerequisite is missing; these checks do not prove sign-in or Neon access.
Do not print credential files.

## First launch: discover Neon

The bridge discovers models from agy and caches the catalog. Before starting
CoS normally, open a temporary discovery-only Pi session from the checkout or
release root. Explicitly load just the bridge so bot extensions do not require
the launcher's environment:

```sh
pnpm --dir bots/cos-bot exec pi --approve --no-extensions --no-session \
  -e ./.pi/npm/node_modules/pi-agy-acp/index.ts
```

Run `/agy-acp refresh`, then `/model`. Confirm `gemini-4-neon` is listed under
`antigravity-acp` and exit without sending a prompt. Discovery uses an ACP
handshake, not a model request. Stop if discovery reports an error or Neon is
absent; do not substitute an unverified model name. `--list-models` alone does
not populate a cold bridge cache on Pi 1.6.1.

Do not run concurrent Pi
instances with the same bridge home. The default bridge home is shared on the
host; use distinct `PI_AGY_HOME` paths for concurrent instances, authenticating
each custom home separately as described upstream.

On the next normal launch, the launcher passes the manifest model explicitly.
Medium thinking initializes only missing settings; existing preferences,
credentials and sessions are preserved. A temporary `/model` selection does
not change the manifest default.

## Separate manual acceptance

Neon availability and tool-call reliability need an operator-run check with
the actual account. Confirm a short reply and a harmless Pi tool call before
relying on this default. The bridge isolates agy's normal tools and skills;
Pi's system prompt and active tools are supplied through the bridge, and Pi
executes tool calls. History replay has a 160,000-byte budget, so older history
and historical images may not be restored in full after a rebuild.
Memory recall still uses Pi hooks and tools;
the memory service's separate Claude Code dream worker is unchanged.

See the [pinned bridge documentation](https://www.npmjs.com/package/pi-agy-acp/v/0.2.4)
for compatibility limits. Documentation support is not proof of a live Neon run.
