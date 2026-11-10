# Browser setup and configuration

CoS and numbered workers use `npm:@amaster.ai/pi-browser-use@0.1.38` with the
host's Chromium. Manager has no browser package, skill, profile, or Chromium
requirement. The owner selected this package instead of Obscura; no comparison
study is implied.

## Installation and ownership

Use the existing source configuration or release `install-runtime` and
`configure-release` flow. Pi owns declared-package installation; no additional
browser installer, MCP registration, or service is needed. Ask the administrator
to supply a missing OS browser; do not install OS packages during validation.

Installed CoS/worker `.pi/settings.json` files declare the package and shared
defaults: `sessionMode: "persistent"`, `headless: true`, and
`viewport: "1440x900"`. They contain no concrete instance profile or executable
path. Each deployed bot has its own private file:

```text
~/.battuta/pi-bots/cos-bot/.pi/settings.json
~/.battuta/pi-bots/manager-bot/.pi/settings.json   # No browser settings
~/.battuta/pi-bots/worker-1/.pi/settings.json
~/.battuta/pi-bots/worker-2/.pi/settings.json
```

Manager setup preserves an existing private settings file; it need not create one.
Launchers set `PI_CODING_AGENT_DIR` to the selected bot's `.pi` directory while
keeping the installed role as cwd. All workers share installed code, not private
settings or browser data. Setup preserves unrelated private settings and rejects
conflicting browser values rather than overwriting them.

Each browser-enabled bot's private browser section selects its absolute
`~/.battuta/pi-bots/<bot>/.pi/browser-research` directory and
`executablePath: "${CHROME_PATH}"`. Alternative attached/isolated modes and live
sessions are disabled. At launch, Battuta discovers `chromium-browser` from the
actual launch PATH and exports its absolute path as `CHROME_PATH`. No executable
path is hard-coded or persisted. Missing Chromium stops Linux launch. macOS
source development can use standard Chrome discovery when that command is absent.

Source CoS settings remain in its checkout `.pi/settings.json`; source workers
have separate instance settings. Their browser data uses the same canonical
private paths above. Never copy cookies, authentication, or profiles between bots.
If a site needs login, the human owns authorized login for that bot; a headed
login is separate from normal headless operation and setup validation.

## Global settings limitation

Do not create or modify `~/.pi/agent/settings.json` for Battuta. The extension's
[shared loader](https://cdn.jsdelivr.net/npm/@amaster.ai/pi-shared@0.1.38/dist/settings.js)
supports `PI_CODING_AGENT_DIR`, but still merges global < private agent < trusted
project settings. There is no supported switch to disable the global read.
Environment references expand in private settings, not project settings.

Battuta explicitly sets its profile/connection values privately and shared
defaults in the installed role. Optional keys not set there can still inherit
global values, and malformed global JSON can prevent loading. Do not edit or
delete the owner's global configuration to hide such a failure; stop and report
it. No fake HOME, wrapper, or patched extension is used.

## Minimal setup validation

Run as the bot user on the Linux host, with tracing disabled. Stop on any failure.
Choose one configured browser-enabled bot and repeat only for other selected bots:

```sh
set -eu
command -v chromium-browser >/dev/null
chromium-browser --version
bot=cos-bot
private="$HOME/.battuta/pi-bots/$bot/.pi"
test -s "$private/settings.json"
test -d "$private/browser-research" && test -w "$private/browser-research"
test -d "$HOME/.battuta/browser-screenshot" && test -w "$HOME/.battuta/browser-screenshot"
```

The executable must be discoverable and report its version; private settings and
writable directories must exist. For source CoS, check the checkout's settings
file instead. Do not dump settings/auth files, invoke Pi/models, browse accounts,
or message bots to validate setup. Browser use and CoS screenshot delivery remain
human acceptance, not an extension or Pi setup test suite.

## Screenshots

The `browser-evidence` skill uses `browser_take_screenshot` with an explicit
absolute `filePath` under `~/.battuta/browser-screenshot/` and a unique bot-prefixed
filename. CoS uses the existing Telegram attachment bridge for authorized delivery;
workers return evidence to Manager for coordination. Capture does not require a
vision model. Queuing an attachment is not proof of delivery. The owner manages
temporary files; do not delete them while an attachment may still be queued.
