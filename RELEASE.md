# Battuta release setup

Fresh Battuta installation on **AArch64** as the ordinary bot user: **Oracle Linux 9**
(platform `oracle-ampere`, main bundle) or **Raspberry Pi OS 13 / Debian trixie**
(platform `raspberry-pi`, influencer bundle). nvm and uv must already be configured. Do not install them, replace system
Python, or run Battuta with sudo. Remote Supabase migrations and Edge Functions
must already be provisioned separately.

Stop on any failed command or incompatible existing configuration. Never print
credentials, invent repairs, copy an old deployment, or start bots to validate
setup. Authentication, model selection, bot messages, and actual work belong to
human acceptance, not agent-run setup checks.

## Choose the installation bundle

Ask the owner which bundle to set up if not specified. Each bundle has its own
platform archive and install instructions: main uses `oracle-ampere`, influencer uses
`raspberry-pi`. Each bundle installs only its wheels: main needs all six, and
influencer needs all except `battuta-memory`. The bundle controls private
configuration and generated services, not the files included in the archive.

| Bundle             | `deployment` | Configured bots                        | Services to activate after approval                                  | Setup validation                                                                           |
| ------------------ | ------------ | -------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Main machine       | `main`       | CoS, Manager, selected general workers | memory, artifacts, speech, documents, CoS, Manager, selected workers | Bundle validation, private configuration and named service status                          |
| Influencer machine | `influencer` | Exactly one influencer worker          | artifacts, speech, selected worker                                   | Bundle validation, worker private configuration, ADB availability and named service status |

Set `deployment=main` or `deployment=influencer` in the trusted shell before
continuing. Pass that same value to both configuration and service generation.
Do not infer a selection or activate services from another bundle. Existing
services are not removed, disabled or stopped by choosing a bundle.

## Layout and ownership

```text
<install-path>/bots/
  release.json                         # Versions and role selections
  _shared/<component>/dist/             # Compiled shared extensions/helpers
  cos-bot/                             # Generated AGENTS.md, .pi/skills and extensions
  manager-bot/
  worker/                              # General worker profile
  worker-influencer/                   # Influencer worker profile

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

Existing private configuration, scheduler and dream files are left untouched.
Setup creates missing files and summarizes created and untouched destinations.
Existing settings also skip browser configuration; review skipped steps before
launch. Unexpected private resources, instructions, symlinks, or malformed
settings stop setup for an owner decision.

Fresh CoS and worker settings include browser configuration. Browser profiles
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
The OS native libraries include `libstdc++` and `libgomp`; have the
administrator supply missing OS packages rather than changing system packages
during agent-run checks.

```bash
set -euo pipefail
case "${deployment:-}" in main|influencer) ;; *) printf 'STOP: choose a bundle first.\n' >&2; exit 1 ;; esac
case "${platform:-}" in oracle-ampere|raspberry-pi) ;; *) printf 'STOP: set platform from the instructions.\n' >&2; exit 1 ;; esac
source /etc/os-release
case "$platform" in
  oracle-ampere) test "$ID" = ol && test "${VERSION_ID%%.*}" = 9 ;;
  raspberry-pi) test "$ID" = debian && test "${VERSION_ID%%.*}" = 13 ;;
esac
test "$(uname -m)" = aarch64
test "$(getconf LONG_BIT)" = 64
command -v uv curl sha256sum script systemctl tmux
test -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
systemctl --user status >/dev/null
```

Every check must succeed. The release requires managed Python 3.12 and the exact
Node/pnpm versions declared in `bots/release.json`. GitHub, PyPI, npm, and Node
download access are needed; there is no offline dependency bundle.
For the influencer bundle, also run `command -v adb`; the owner must provide an
authorized Android device with USB debugging, and configure `ANDROID_SERIAL` when
needed. Unicode input requires ADBKeyboard. Device readiness is checked on launch,
not by starting a bot during setup.

Download these assets from the selected GitHub Release into a separate download
directory, not the installation:

- `battuta-vX.Y.Z-<platform>-arm64.tar.gz` and its `.sha256`, for your platform.
- Wheels for your bundle (filenames use underscores): `battuta-project`, `battuta-artifacts`,
  `battuta-speech`, `battuta-bot-setup`, and `battuta-packaging`; main also needs `battuta-memory` and `battuta-doc`.
- `python-tools-version.txt` and `python-tools-SHA256SUMS`.

Set the real tag and platform. Ask the owner for the absolute installation path if it
is not given; do not choose one. It must be new and empty, and service generation
rejects paths with spaces or systemd special characters. From the download directory:

```bash
version=vX.Y.Z
platform=oracle-ampere # raspberry-pi for the influencer bundle
archive="battuta-$version-$platform-arm64.tar.gz"
install_path="<absolute path the owner approved>"
sha256sum -c "$archive.sha256"
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
case "$deployment" in
  main) packages="battuta-project battuta-artifacts battuta-memory battuta-speech battuta-doc battuta-bot-setup battuta-packaging" ;;
  influencer) packages="battuta-project battuta-artifacts battuta-speech battuta-bot-setup battuta-packaging" ;;
esac
for package in $packages; do
  wheel="${package//-/_}-$tool_version-py3-none-any.whl"
  uv tool install --managed-python --python 3.12 --no-build "./$wheel"
done
export PATH="$(uv tool dir --bin):$PATH"
for package in $packages; do
  "${package/battuta-artifacts/battuta-artifact}" --help >/dev/null
done
```

All commands must succeed. A direct wheel URL also works with
`uv tool install --managed-python --python 3.12 "<wheel-url>"`; the procedure above
additionally verifies the downloaded top-level wheel checksums and refuses native
source compilation. Pins are not a dependency hash lock or an offline wheelhouse.

Each listed wheel needs its own tool installation so its CLI command is exposed.
An internal dependency inside another tool's environment does not expose its CLI,
so `battuta-project` must be installed even though `battuta-artifacts` depends on it.
`battuta-bot-setup` is used for configuration and `battuta-packaging` by generated services.
Project registrations live under `~/.battuta/projects`. Initializing a project
from GitHub also requires Git and the GitHub CLI (`gh`), authenticated as the bot
user with access to the intended repository. Name-only initialization needs neither.
Generated services include the uv tool directory on `PATH`; ensure custom Git and
`gh` locations are also available to services when needed.

## 3. Extract bots and install JavaScript dependencies

```bash
battuta-packaging extract-bots \
  --archive "$archive" --root "$install_path"
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

Have the owner fill credentials in a private editor, never chat: both bundles need
the Supabase URL and secret key. The main bundle also needs the CoS Telegram token
and allowed user ID and Linear token. Confirm the intended
remote backend. Use literal shell-compatible values, quoted when needed; do not
use command substitution or variable expansion. Keep optional service overrides
here too.

For `main`, select instances with `BATTUTA_WORKER_1_TYPE=general` and additional
numbered entries as needed; no entries selects no workers. For `influencer`, set
exactly one entry, for example `BATTUTA_WORKER_1_TYPE=influencer`. Types are declared in the worker
manifest; invalid selections fail before launch. See [worker capabilities](docs/bot-setup.md#worker-capabilities).
Changes require a restart, not live autoscaling.

For `main` only, before configuration, stop CoS and set the required `BATTUTA_DREAM_MODEL` to an
exact `provider/model-id` in the selected environment file. It has no default and
is independent of conversational model preferences. Configuration provisions the
nightly dream task; a missed run may execute when CoS next starts.

```bash
battuta-bot-setup configure-release --root "$install_path" --env-file "$env_file" \
  --deployment "${deployment:?Choose main or influencer}"
```

Expected: separate flat private bot homes and role-appropriate generated files for
the chosen bundle only. For an influencer selection of worker-1, verify the private
files exist without displaying credentials:

```bash
if [[ "$deployment" == influencer ]]; then
  worker=worker-1 # Use the selected instance number.
  test -f "$HOME/.battuta/pi-bots/$worker/.pi/settings.json"
  test -f "$HOME/.battuta/pi-bots/$worker/.pi/mcp.json"
fi
```

Setup does not copy or rewrite private model/authentication files or start bots.
CoS alone receives Telegram configuration. Repeating configuration preserves
existing private files.

## 5. Provision application services

In the same trusted private shell, load the same environment used by services.
For the main bundle provision memory; the influencer bundle does not use it:

```bash
set -a
source "$env_file"
set +a
if [[ "${deployment:?Choose main or influencer}" == main ]]; then
  battuta-memory model install
  battuta-memory model verify --json
  battuta-memory doctor --json
fi
battuta-artifact setup
battuta-packaging install-speech
battuta-packaging verify-speech
```

These provision the selected memory model/data, artifact schema, and speech assets without starting bots.
Every command must succeed. Optional offline model input and detailed native
prerequisites belong to the component guides below. Do not invoke a model provider,
authenticate Pi, or message bots as a setup check.

## 6. Install services; activation is separate

```bash
battuta-packaging install-services --root "$install_path" \
  --env-file "$env_file" --node "$node" \
  --deployment "${deployment:?Choose main or influencer}"
```

The main bundle writes CoS, Manager, memory, artifact, speech, document, and
`battuta-worker@.service` definitions. The influencer bundle writes only artifact,
speech, and `battuta-worker@.service` definitions. Confirm the printed activation
list matches the table above before proceeding.
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

The human owns provider login/model selection and an authorized worker assignment
reaching Manager. For the main bundle, acceptance also includes a Telegram reply
from CoS. Use each bot's exact private agent
directory and the maintenance procedure; never copy another bot's authentication.
Service status proves startup only. Report setup as awaiting human acceptance until
the owner confirms it.

## Extension and skill setup index

| Component                              | Setup                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| Pi, Telegram, agent mail, project-spec | Compiled bundle plus install-runtime; remote Supabase is provisioned separately |
| Shared memory and nightly CoS dream    | [Memory setup](docs/memory-service-setup.md)                                    |
| Shared speech MCP                      | [Speech setup](docs/speech-service-setup.md)                                    |
| Document parsing MCP (main only)       | [Document service setup](docs/doc-service-setup.md)                             |
| Artifact service and CLI               | [Artifact setup](docs/artifact-service-setup.md)                                |
| Project-management CLI                 | Installed with the Python wheels above                                          |
| Assignment MCP                         | [Assignment setup](docs/assignments-setup.md)                                   |
| Assignment remote files                | [Remote files setup](docs/assignment-remote-files-setup.md)                     |
| Workers and numbered instances         | [Worker setup](docs/workers-setup.md)                                           |
| Worker researcher subagent             | [Subagent setup](docs/subagents-setup.md)                                       |
| Worker Claude Code delegation          | [Delegation setup](docs/delegation-setup.md)                                    |
| CoS and worker browsers                | [Browser setup](docs/browser-setup.md)                                          |
| Google CLI                             | [Google setup](docs/gogcli-setup.md)                                            |
| Luma                                   | [Luma setup](docs/luma-setup.md)                                                |
| CoS scheduler                          | [Scheduler](docs/scheduler.md)                                                  |
| Per-role skills                        | [Skill management](docs/skill-management.md)                                    |
| Source extensions/contributor tools    | [Pi extensions](docs/pi-extensions.md), [OpenCode](docs/opencode.md)            |
