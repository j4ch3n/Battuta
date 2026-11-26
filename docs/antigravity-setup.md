# Antigravity setup

CoS defaults to `agy/gemini-4-neon` through the pinned
`@timmyjl12/pi-agy-bridge@0.4.2` package. It runs the official Antigravity
CLI's `agy acp` server using the host operator's Google login, not Gemini CLI
or a Gemini API key. Pi retains conversation history, tool execution and
approvals. Claude remains installed; other bots' defaults are unchanged.

## Prerequisites and installation

- Use Battuta's pinned Node and Pi versions. The bridge requires Node 22.19+
  and Pi 1.5+.
- Install the official [Antigravity CLI](https://antigravity.google/docs/ide/extensions/acp/)
  on the bot host's `PATH`. The bridge requires agy 1.5.1+; Neon was first
  reported in agy 1.5.12, so use 1.5.12+ for this default.
- The host operator must run `agy` interactively and sign in with a Google
  account that offers Neon. Keep login data private and out of releases.
  Do not configure the bridge's optional Gemini API-key mode; that uses separate
  per-token billing.

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
test -f bots/cos-bot/.pi/npm/node_modules/@timmyjl12/pi-agy-bridge/package.json
```

Expect agy 1.5.12+, a help page with ACP options, Battuta's pinned Node/Pi
versions and an installed bridge package. Stop if a command fails or a
prerequisite is missing; these checks do not prove sign-in or Neon access.
Do not print credential files.

## First launch: discover Neon

Neon is discovered from agy, not included in the bridge's static fallback
catalog. Before starting CoS normally, the operator should open a temporary
interactive Pi session from the checkout or release root:

```sh
PI_CODING_AGENT_DIR="$HOME/.battuta/pi-bots/cos-bot/.pi" \
  pnpm --dir bots/cos-bot exec pi --model agy/gemini-3.8-flash
```

Open `/model` and wait for catalog refresh, then confirm `agy/gemini-4-neon`
is listed. Do not send a prompt. This discovery uses an ACP handshake, not a
model request. Exit the temporary session before starting CoS normally.
The Flash argument lets discovery open before Neon is cached; it does not
change the manifest. Stop if the CLI, login or Neon is unavailable.

On the next normal launch, the launcher passes the manifest model explicitly.
Medium thinking initializes only missing settings; existing preferences,
credentials and sessions are preserved. A temporary `/model` selection does
not change the manifest default.

## Separate manual acceptance

Neon availability and tool-call reliability need an operator-run check with
the actual account. Confirm a short reply and a harmless Pi tool call before
relying on this default. The bridge uses a text tool-call protocol, so valid
model-generated JSON is required. Memory recall still uses Pi hooks and tools;
the memory service's separate Claude Code dream worker is unchanged.

See the [pinned bridge documentation](https://www.npmjs.com/package/@timmyjl12/pi-agy-bridge/v/0.4.2)
for compatibility limits. Documentation support is not proof of a live Neon run.
