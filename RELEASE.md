# OCI Ampere A1 release setup

Fresh Battuta installation on **Oracle Linux 9 / AArch64**, as the ordinary bot
user. nvm and uv must already be configured. Do not install them, replace system
Python, or run Battuta with sudo. Remote Supabase migrations and Edge Functions
must already be provisioned separately.

Stop on any failed command or incompatible existing configuration. Never print
credentials, invent repairs, copy an old deployment, or start bots to validate
setup. Authentication, model selection, bot messages, and actual work belong to
human acceptance, not agent-run setup checks.

## Layout and ownership

```text
<install-path>/bots/
  release.json                         # Versions and role selections
  _shared/<component>/dist/             # Compiled shared extensions/helpers
  cos-bot/                             # Generated AGENTS.md, .pi/skills and extensions
  manager-bot/
  worker/                              # One installed role for all workers

~/.battuta/
  .env.prod                            # Operator credentials/configuration
  pi-bots/
    cos-bot/.pi/                       # Private settings/auth/models/sessions
    manager-bot/.pi/
    worker-1/.pi/
    worker-2/.pi/
```

The `bots/` directory contains compiled JavaScript, generated instructions,
complete per-role skills, resources, notices, and dependency manifests/lockfiles.
JavaScript dependencies and Pi packages are installed **inside the installation**.
Python servers/CLIs are separate wheels installed into uv-managed environments.

Private `settings.json`, `auth.json`, `models.json`, OAuth state, and sessions are
preserved. Setup completely regenerates owned MCP, Telegram, and web-search files;
it does not merge historical values. Installed project settings own resources but
do not override the private model/provider defaults. Unexpected private resources,
instructions, symlinks, or malformed settings stop setup for an owner decision.

CoS and workers also merge owned browser settings into their separate private
`settings.json` files; unrelated preferences remain unchanged. Browser profiles
live under each bot's `.pi/browser-research/`, not inside the installation.
Manager receives no browser configuration. Battuta does not provision global Pi
settings; the browser extension's lower-priority global fallback is documented in
its setup guide below.

Everything under the installation is replaceable. It must be empty for extraction;
setup never clears it automatically. Never clear `~/.battuta` or service data.
Replacement requires stopping affected services and explicit owner approval; this
guide does not migrate deployments or provide database rollback.

## 1. Check prerequisites and download

Use Bash with shell tracing disabled. The bot user needs `curl`, `sha256sum`,
`script`, working systemd user services, and tmux for requested UI maintenance.
Oracle Linux native libraries include `libstdc++` and `libgomp`; have the
administrator supply missing OS packages rather than changing system packages
during agent-run checks.

```bash
set -euo pipefail
source /etc/os-release
test "$ID" = ol && test "${VERSION_ID%%.*}" = 9
test "$(uname -m)" = aarch64
test "$(getconf LONG_BIT)" = 64
command -v uv curl sha256sum script systemctl tmux
test -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
systemctl --user status >/dev/null
```

Every check must succeed. The release requires managed Python 3.12 and the exact
Node/pnpm versions declared in `bots/release.json`. GitHub, PyPI, npm, and Node
download access are needed; there is no offline dependency bundle.

Download these assets from the selected GitHub Release into a separate download
directory, not the installation:

- `battuta-vX.Y.Z-linux-arm64.tar.gz` and its `.sha256`.
- Six wheels: `battuta-project`, `battuta-artifacts`, `battuta-memory`, `battuta-speech`,
  `battuta-bot-setup`, and `battuta-packaging` (wheel filenames use underscores).
- `python-tools-version.txt` and `python-tools-SHA256SUMS`.

Set the real tag and absolute installation path; paths used by service generation
must not contain spaces or systemd special characters. From the download directory:

```bash
version=vX.Y.Z
install_path="$HOME/battuta/current"
sha256sum -c "battuta-$version-linux-arm64.tar.gz.sha256"
sha256sum -c python-tools-SHA256SUMS
tool_version="$(cat python-tools-version.txt)"
```

Both checksum checks must report `OK` for every asset. Never extract or install an
unverified download.

## 2. Install self-describing Python wheels

Each wheel carries exact runtime dependency pins in standard `Requires-Dist`
metadata. Internal Battuta dependencies point to wheels from the **same release**.
uv reads that metadata automatically; there are no separate constraint files,
source installations, or `--with` arguments.

```bash
for package in battuta-project battuta-artifacts battuta-memory battuta-speech battuta-bot-setup battuta-packaging; do
  wheel="${package//-/_}-$tool_version-py3-none-any.whl"
  uv tool install --managed-python --python 3.12 --no-build "./$wheel"
done
export PATH="$(uv tool dir --bin):$PATH"
for command in battuta-project battuta-artifact battuta-memory battuta-speech battuta-bot-setup battuta-packaging; do
  "$command" --help >/dev/null
done
```

All commands must succeed. A direct wheel URL also works with
`uv tool install --managed-python --python 3.12 "<wheel-url>"`; the procedure above
additionally verifies the downloaded top-level wheel checksums and refuses native
source compilation. Pins are not a dependency hash lock or an offline wheelhouse.

All six tools need their own installation so their CLI commands are exposed.
An internal dependency inside another tool's environment does not expose its CLI.
Project registrations live under `~/.battuta/projects`. Initializing a project
from GitHub also requires Git and the GitHub CLI (`gh`), authenticated as the bot
user with access to the intended repository. Name-only initialization needs neither.
Generated services include the uv tool directory on `PATH`; ensure custom Git and
`gh` locations are also available to services when needed.

## 3. Extract bots and install JavaScript dependencies

```bash
battuta-packaging extract-bots \
  --archive "battuta-$version-linux-arm64.tar.gz" --root "$install_path"
node_version="$(uv run --no-project --python 3.12 python -c 'import json,sys; print(json.load(open(sys.argv[1]))["node"])' "$install_path/bots/release.json")"
package_manager="$(uv run --no-project --python 3.12 python -c 'import json,sys; print(json.load(open(sys.argv[1]))["packageManager"])' "$install_path/bots/release.json")"
source "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
nvm install "$node_version"
nvm use "$node_version"
node="$(command -v node)"
npm install --global "$package_manager"
battuta-packaging install-runtime --root "$install_path" --node "$node"
battuta-packaging validate-bundle --root "$install_path"
```

Extraction refuses nonempty/symlink destinations, archive traversal, links, and
special files. Dependency installation uses frozen production lockfiles and exact
Pi package versions. It does not launch a bot or install packages into private
agent directories. Ordinary bot startup rejects incomplete installation or missing
and mismatched Pi packages; rerun `install-runtime` before proceeding. Pi runs with
`--offline` to disable startup downloads and update checks, not provider requests.

Expected: validation succeeds; all compiled entry points and selected skills exist.
The selected absolute Node executable is recorded in `bots/runtime.json`. Services
use it explicitly, not the user's interactive nvm default or shell startup files.

## 4. Create private configuration

```bash
umask 077
mkdir -p "$HOME/.battuta"
env_file="$HOME/.battuta/.env.prod"
if [[ -L "$env_file" ]]; then
  printf 'STOP: private environment must not be a symlink.\n' >&2
  exit 1
fi
if [[ ! -e "$env_file" ]]; then
  battuta-bot-setup env-example > "$env_file"
fi
chmod 600 "$env_file"
```

Have the owner fill credentials in a private editor, never chat: CoS Telegram token
and allowed user ID, Linear token, Supabase URL and secret key. Confirm the intended
remote backend. Use literal shell-compatible values, quoted when needed; do not
use command substitution or variable expansion. Keep optional service overrides
here too.

Set `WORKER_BOT_COUNT` explicitly: `1` is the normal local example, `0` disables
workers, and `N` selects `worker-1` through `worker-N`. Missing/invalid values fail
before configuration or launch. This setting is not live autoscaling.

Before configuration, stop CoS and set the required `BATTUTA_DREAM_MODEL` to an
exact `provider/model-id` in the selected environment file. It has no default and
is independent of conversational model preferences. Configuration provisions the
nightly dream task; a missed run may execute when CoS next starts.

```bash
battuta-bot-setup configure-release --root "$install_path" --env-file "$env_file"
```

Expected: separate flat private bot homes and role-appropriate generated files;
no private model/authentication files copied or rewritten, no bots started. CoS
alone receives Telegram configuration. Repeating configuration replaces owned
configuration while leaving private state unchanged.

## 5. Provision application services

In the same trusted private shell, load the same environment used by services:

```bash
set -a
source "$env_file"
set +a
battuta-memory model install
battuta-memory model verify --json
battuta-memory doctor --json
battuta-artifact setup
battuta-packaging install-speech
battuta-packaging verify-speech
```

These provision the memory model/data, artifact schema, and speech assets without starting bots.
Every command must succeed. Optional offline model input and detailed native
prerequisites belong to the component guides below. Do not invoke a model provider,
authenticate Pi, or message bots as a setup check.

## 6. Install services; activation is separate

```bash
battuta-packaging install-services --root "$install_path" \
  --env-file "$env_file" --node "$node"
```

This writes CoS, Manager, memory, artifact, speech, and `battuta-worker@.service` definitions.
It prints the exact reload/activation commands for the configured count, but does
not execute them. Conflicting units, symlinks, and excess running workers stop setup.
`--replace` requires explicit approval and stopped affected services; review custom
unit edits and drop-ins rather than silently discarding them.

**Only after owner approval**, execute the printed `daemon-reload` and
`enable --now` commands. Workers may immediately claim queued work. Verify each
named service with `systemctl --user status`; failures require sanitized reporting,
not model calls or automatic recovery. An administrator may enable lingering for
this user if operation after logout/at boot is required.

## Logs and explicitly requested Pi UI

Logs do not interrupt a worker or open its interactive UI. For a specifically
requested worker, for example worker-2:

```sh
journalctl --user -u battuta-worker@2.service -f
```

Opening the Pi UI requires **foreground maintenance and an explicitly named bot**.
Ask which bot if unspecified. Confirm a worker is idle or obtain approval to
interrupt it; stopping a process does not release its assignment claim.

Example `open-bot-ui.sh` below takes the named bot and installation as arguments.
It stops that service and opens **one bot in one tmux pane**. It never starts a
second process for the same bot, enables pane respawn, or restarts the service:

```bash
#!/usr/bin/env bash
set -euo pipefail
bot="${1:?Specify cos-bot, manager-bot, or worker-N for foreground maintenance}"
install_path="${2:?Specify the absolute installation path}"
case "$bot" in
  cos-bot) unit=battuta-cos.service ;;
  manager-bot) unit=battuta-manager.service ;;
  *)
    [[ "$bot" =~ ^worker-[1-9][0-9]*$ ]] || exit 1
    unit="battuta-worker@${bot#worker-}.service"
    ;;
esac
node="$(uv run --no-project --python 3.12 python -c 'import json,sys; print(json.load(open(sys.argv[1]))["node"])' "$install_path/bots/runtime.json")"
systemctl --user stop "$unit"
test "$(systemctl --user show "$unit" --property=ActiveState --value)" = inactive
tmux new-session -s "battuta-maint-$bot" -n "$bot" -- \
  battuta-packaging run-bot --root "$install_path" --bot "$bot" \
  --env-file "$HOME/.battuta/.env.prod" --node "$node" --mode foreground-maintenance
```

The launcher checks service state and holds the instance lock. A duplicate or
occupied session fails; do not bypass it. Foreground workers can claim real work.
**Detaching tmux leaves Pi running**: it is not permission to restart the service.

After the human exits Pi and verifies the maintenance pane/process has ended,
return the **same selected instance** to service in a separate action, for example:

```sh
systemctl --user start battuta-worker@2.service
```

Stop/launch/exit failures require an owner decision; no automatic restart or repair.

## Human acceptance

The human owns provider login/model selection, a Telegram reply from CoS, and an
authorized worker assignment reaching Manager. Use each bot's exact private agent
directory and the maintenance procedure; never copy another bot's authentication.
Service status proves startup only. Report setup as awaiting human acceptance until
the owner confirms it.

## Extension and skill setup index

| Component                              | Setup                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| Pi, Telegram, agent mail, project-spec | Compiled bundle plus install-runtime; remote Supabase is provisioned separately |
| Shared memory and nightly CoS dream    | [Memory setup](docs/memory-service-setup.md)                                    |
| Shared speech MCP                      | [Speech setup](docs/speech-service-setup.md)                                    |
| Artifact service and CLI               | [Artifact setup](docs/artifact-service-setup.md)                                |
| Project-management CLI                 | Installed with the Python wheels above                                          |
| Assignment MCP                         | [Assignment setup](docs/assignments-setup.md)                                   |
| Workers and numbered instances         | [Worker setup](docs/workers-setup.md)                                           |
| Worker researcher/reviewer subagents   | [Subagent setup](docs/subagents-setup.md)                                       |
| CoS and worker browsers                | [Browser setup](docs/browser-setup.md)                                          |
| Google CLI                             | [Google setup](docs/gogcli-setup.md)                                            |
| Luma                                   | [Luma setup](docs/luma-setup.md)                                                |
| CoS scheduler                          | [Scheduler](docs/scheduler.md)                                                  |
| Per-role skills                        | [Skill management](docs/skill-management.md)                                    |
| Source extensions/contributor tools    | [Pi extensions](docs/pi-extensions.md), [OpenCode](docs/opencode.md)            |
