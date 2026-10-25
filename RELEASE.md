# Raspberry Pi release setup

This guide is for installing the prebuilt **64-bit Linux ARM** Battuta release on Raspberry Pi OS. An agent helping with installation should work through the steps in order on the target machine. At each step, first perform its **Already done?** check and skip actions that are already complete; inspect results before proceeding, explain any failure, and ask the owner for credentials or interactive authentication when needed. Never print, paste into chat, or commit secrets. Do not assume a command succeeded merely because it was issued.

## Extension and skill setup index

Installation navigation lives here, separate from runtime skill workflows and command contracts. Use the component's setup guide below; bundled resources do not need separate installation. When adding an extension or skill, update this index with its installation guide or explicitly state how the release configures it.

| Component                                                  | Installation and configuration                                                                                                                                                                                                                                 |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pi, PM/TL runtime extensions, agent mail, and project-spec | Bundled with dependencies; [configure and launch both bots](#5-configure-and-launch). Deploy the remote Supabase backend separately as required in [prerequisites](#1-confirm-the-target-and-prerequisites).                                                   |
| Telegram extension (both bots)                             | Bundled; supply credentials in [step 4](#4-prepare-production-credentials), then configure and launch in [step 5](#5-configure-and-launch).                                                                                                                    |
| Prompt scheduler (PM only)                                 | Bundled; [PM scheduler](docs/scheduler.md) covers fresh setup, stable storage, scopes, and runtime checks.                                                                                                                                                     |
| Native Pi subagents (TL only)                              | Bundled and configured by normal TL setup; reuse TL's existing Pi login. See [subagent setup](docs/subagents-setup.md).                                                                                                                                        |
| Shared memory MCP and thin client (both bots)              | See [memory service setup](docs/memory-service-setup.md). Configuration exposes one local MCP endpoint; setup provisions the Python runtime and verified ONNX model.                                                                                           |
| Artifact service, CLI, and PM artifact skill               | See [artifact service setup](docs/artifact-service-setup.md). Explicit setup installs dependencies and applies Alembic migrations; the tracked PM skill is discovered in place.                                                                                |
| PM/TL memory skills                                        | Tracked directly in each bot's `.pi/skills/memory/`: PM read/write, TL read-only. Pi discovers them without skill installation or linking; bot configuration disables TL automatic capture.                                                                    |
| Nightly PM memory dream                                    | Optional operator activation after model login and timezone/profile review; follow [nightly dream setup](docs/memory-service-setup.md#nightly-pm-dream-setup). Uses the bundled PM scheduler, not a second timer.                                              |
| Project-context skill and `battuta-project`                | The skill is bundled and linked for both bots. Install the CLI and ripgrep for notebook search using the [project-context installation guide](shared-skills/project-context/references/installation.md), including release wheels and both bots' service PATH. |
| Google management skill (PM only)                          | The skill is bundled; install and authenticate its external `gog` CLI using the [Google setup guide](docs/gogcli-setup.md).                                                                                                                                    |
| Luma event discovery (PM only)                             | Configured by normal setup; complete owner-initiated Pi OAuth using [Luma setup](docs/luma-setup.md) before launching PM. Preserve `mcp-auth.json` during upgrades.                                                                                            |
| Other bot-local Markdown skills                            | Bundled under each bot's `.pi/skills/`; no package installation. Configuration also establishes the shared skill links.                                                                                                                                        |
| Additional Pi packages (source checkouts)                  | Follow the [Pi-extension installation guide](https://github.com/j4ch3n/Battuta/blob/main/docs/pi-extensions.md). This contributor workflow requires source tooling, not just the release archive.                                                              |
| OpenCode contributor skills/plugins (source checkouts)     | Follow [OpenCode setup](https://github.com/j4ch3n/Battuta/blob/main/docs/opencode.md). These development-agent workflows are not the PM/TL runtime skill environment.                                                                                          |

## 1. Confirm the target and prerequisites

### Already done?

Even on a previously configured machine, run the read-only checks in **Fresh setup** to confirm the architecture, Python version, and tools for the chosen launch method. If they pass, do not reinstall anything. Ask whether the remote Supabase backend and required credentials are ready; never infer that from an old installation.

### Fresh setup

Run these checks as the ordinary user who will run Battuta:

```sh
uname -m
python3 --version
command -v python3 tmux script systemctl
systemctl --version
tmux -V
```

Expect `aarch64`/`arm64` and Python **3.12+**. The release bundles Node, Pi, and bot dependencies; it does not require pnpm, Docker, or local Supabase. Project-context tooling requires uv; Git and GitHub CLI are needed only for GitHub cloning, not name-only initialization or metadata linking. Its bundled wheels target Python **3.12** on Linux ARM64. Install it using the [project-context installation reference](shared-skills/project-context/references/installation.md) before project work. If Python is missing or too old, arrange a supported installation without replacing the OS Python, then recheck. `tmux` is needed for the interactive screen launcher; on Raspberry Pi OS install it if missing with `sudo apt update && sudo apt install tmux`. `script` and working `systemctl --user` are needed only for the optional services in step 6. Check those separately before choosing services; follow the OS's supported user-session setup if unavailable. Do not continue until the tools for the chosen launch method work.

Confirm with the owner that a **remote Supabase project** has already been deployed with Battuta's database migrations and Edge Functions, and that they have two distinct Telegram bot tokens, their numeric Telegram user ID, a Linear API key, and remote Supabase URL and secret key. This archive does not deploy Supabase. If the remote backend is not ready, pause here and arrange its deployment before launching the bots.

For the PM bot's Gmail and Calendar prerequisites, follow the [gogcli setup guide](docs/gogcli-setup.md).

## 2. Download and verify the release

### Already done?

Check whether the owner already has the requested version's archive **and matching checksum file**. If so, run the verification command below and reuse them when it reports `OK`; download only missing or invalid files. If the owner has a working installation of the requested version and is not asking to reinstall, skip extraction and proceed to checking its configuration in step 4.

### Fresh setup

Ask the owner which version to install and where to keep it. From the project's GitHub Releases page, download both `battuta-<version>-linux-arm64.tar.gz` and the corresponding `.sha256` into the same directory. Verify the pair **before** extracting:

```sh
sha256sum -c battuta-<version>-linux-arm64.tar.gz.sha256
```

Replace `<version>` with the actual release tag. Expect `OK`; if verification fails, stop and download both files again. The archive includes this `RELEASE.md` guide at its root.

## 3. Extract to a stable location

### Already done?

Inspect the intended target before extraction. If `bin/battuta`, `.env.example`, and `RELEASE.md` are present, confirm with the owner that this installation is the requested version. If it is, reuse it and continue at step 4; if it is older, use step 7. If the directory exists but is incomplete or its version is unclear, investigate before changing it. Never unpack over an existing installation simply to retry setup.

### Fresh setup

Choose an installation path with no spaces if services may be used. Check whether the target already exists before extracting: if it does, preserve its configuration and Pi state and follow step 7 rather than overwriting it. For a new install at `~/apps/battuta`:

```sh
mkdir -p ~/apps
tar -xzf battuta-<version>-linux-arm64.tar.gz -C ~/apps
cd ~/apps/battuta
test -x bin/battuta && test -f .env.example && test -f RELEASE.md
```

Run subsequent commands from this extracted installation directory. If the final check fails, stop and inspect the extraction.

Install `battuta-project` from the included wheels as described in the [installation reference](shared-skills/project-context/references/installation.md). If GitHub cloning is needed, verify GitHub authentication as the bot user; defer `battuta-project --help` until step 4 has made the required Linear token available.

## 4. Prepare production credentials

### Already done?

Check whether `.env.prod` exists and is private (`stat -c '%a' .env.prod` on Raspberry Pi OS). If it exists with mode `600`, ask the owner to confirm that all required values are present, including `LINEAR_API_TOKEN` and, for Google file-keyring access, `GOG_KEYRING_PASSWORD`, and point to the intended services; do not display or replace the file. If it is missing, create it below. If permissions are too broad, restrict them before proceeding. Also check credential availability from a new terminal as described below; an existing bot's environment does not establish that other sessions have the credentials.

### Fresh setup

Create the environment file only if absent, and restrict access before the owner fills it in:

```sh
test -e .env.prod || cp .env.example .env.prod
chmod 600 .env.prod
```

Have the owner enter `PM_TELEGRAM_TOKEN`, `TL_TELEGRAM_TOKEN`, `TELEGRAM_ALLOWED_USER_ID`, `LINEAR_API_TOKEN`, `SUPABASE_URL`, and `SUPABASE_SECRET_KEY` into `.env.prod` using a private editor. The tokens must belong to different bots; the Supabase values must refer to the **deployed remote project**. Linear MCP and `battuta-project` use the same `LINEAR_API_TOKEN`. Optional usernames are described in the template. Do not request credential values in chat, put them in shell commands, or display the file's contents. Ask the owner to confirm all required values are present before continuing.

For Google file-keyring access, have the owner also add `GOG_KEYRING_PASSWORD` to the same private `.env.prod` file. Its value must match the password protecting the existing gog keyring; use shell-compatible quoting as needed. Keep `.env.prod` as the credential source rather than copying the password into `~/.bashrc`. Follow the [gogcli setup guide](docs/gogcli-setup.md) for keyring configuration and authentication.

### Make the Linear token and Google keyring password available across Battuta sessions

Keep `.env.prod` as the single credential source. The release foreground commands, both production tmux panes, and both user services load it and export its variables before starting Pi. Their child commands inherit `LINEAR_API_TOKEN` and `GOG_KEYRING_PASSWORD` when present; this does not export the credentials back into other terminals on the machine.

For standalone Pi sessions, `battuta-project`, and `gog` commands under the same OS user, add this snippet once to both `~/.profile` (login shells) and `~/.bashrc` (interactive Bash shells) using an editor. If the existing snippet exports only `LINEAR_API_TOKEN`, replace it with this version. If `~/.bash_profile` or `~/.bash_login` exists, ensure it sources `~/.profile` or put the login-shell snippet there instead. Replace the example path with the actual stable installation path. If the user uses another shell, configure its equivalent startup file instead.

```sh
if [ -r "$HOME/apps/battuta/.env.prod" ]; then
  LINEAR_API_TOKEN="$(
    unset LINEAR_API_TOKEN
    . "$HOME/apps/battuta/.env.prod"
    printf '%s' "${LINEAR_API_TOKEN:-}"
  )"
  GOG_KEYRING_PASSWORD="$(
    unset GOG_KEYRING_PASSWORD
    . "$HOME/apps/battuta/.env.prod"
    printf '%s' "${GOG_KEYRING_PASSWORD:-}"
  )"
  export LINEAR_API_TOKEN GOG_KEYRING_PASSWORD
fi
```

The subshells read the private file but export only the Linear token and Google keyring password to the terminal; the other production credentials stay inside the subshells. Use the same shell-compatible assignments as the environment template and keep tracing (`set -x`) disabled when loading credentials. Do not copy credential values into startup files or make `.env.prod` world-readable.

Open a new terminal under the bot user and verify without printing credential values:

```sh
test -n "${LINEAR_API_TOKEN:-}" && printf 'Linear token is available\n'
test -n "${GOG_KEYRING_PASSWORD:-}" && printf 'Google keyring password is available\n'
battuta-project --help
```

If the Linear check does not print its confirmation, resolve the environment setup before continuing. If Google file-keyring access is being configured, its password check must also print its confirmation; otherwise resolve it before using Google operations. Run these checks in any standalone Pi session used for Battuta as well. Existing shells and Pi processes retain their old environment: reopen standalone sessions and restart running bots after setup or rotation. For production tmux, stop the bot session and launch it again; reattaching does not reload credentials. Systemd services load `.env.prod` through the release launcher, so they do not depend on shell startup files.

### Verify Google access for the PM bot

Follow the [gogcli setup guide](docs/gogcli-setup.md) for installation, account selection, authentication, and read-access checks.

## 5. Configure and launch

### Already done?

Check whether both bots already have generated instructions and Telegram/MCP configuration (`bots/pm-bot/AGENTS.md`, `bots/tl-bot/AGENTS.md`, and each bot's `.pi/telegram.json` and `.pi/mcp.json`). Confirm that each Linear MCP entry has `headers.Authorization` set to the literal `Bearer ${LINEAR_API_TOKEN}` and `exposure` set to `codemode`, and that neither bot's `.pi/settings.json` includes `pi-mcp-adapter`. PM must also have the CIMD Luma entry with hidden-by-default exposure described in [Luma setup](docs/luma-setup.md#1-check-configuration). If configuration is present, uses this native format, and the owner confirms credentials have not changed, do not rerun `configure`. Validate the retained PM Luma login using that guide's CLI checks; skip login only if connected. Check for an existing tmux session and run `systemctl --user is-active battuta-pm.service battuta-tl.service` before starting anything; an inactive-service result is normal when using tmux. If services are active, do not start a screen session. Do not use a bot response as a setup check.

### Fresh setup

If configuration is missing, still uses the adapter format, or credentials changed, stop any running bots before reconfiguring. Then run:

```sh
bin/battuta configure
```

Stop and resolve any configuration error before launching. Complete the owner's **PM-only Luma OAuth login** and CLI checks in [Luma setup](docs/luma-setup.md#2-owner-sign-in), using PM's `PI_CODING_AGENT_DIR`; neither `configure` nor model-provider `/login` authenticates Luma. Reuse a connected retained login rather than asking the owner to authorize again. Then launch:

```sh
bin/battuta start-prod-screen
```

If configuration and Luma authentication were already valid but no bots are running, run only the screen command. It opens or reattaches a tmux session with one pane per bot. In **each** Pi pane the owner must run `/login` if not already authenticated and complete model-provider authentication. Detach with `Ctrl-b d`; rerun `bin/battuta start-prod-screen` to reattach. Alternatively launch one bot in the foreground with `bin/battuta pm` or `bin/battuta tl`. Keep only one process per bot/session.

Pi provides MCP natively. With `codemode` exposure, Linear tools are discovered and called through native codemode; their names use `mcp__linear__<tool>`. For connection diagnostics without starting another bot session, load `.env.prod` as in step 4 and run the bundled CLI from each bot directory:

```sh
(cd bots/pm-bot && PI_CODING_AGENT_DIR="$PWD/.pi" ../../bin/node node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js mcp list)
(cd bots/tl-bot && PI_CODING_AGENT_DIR="$PWD/.pi" ../../bin/node node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js mcp list)
```

Expect Linear to be connected with tools listed; a nonzero exit indicates invalid configuration or a connection failure. Pi 1.0.0 uses fullscreen TUI by default; set `tuiMode` to `regular` in bot settings if terminal scrollback is preferred.

Confirm scheduler storage was initialized without starting a model request:

```sh
test -s "$HOME/.battuta/schedule-prompts.json"
```

The command must exit zero. Google setup uses the local [command-environment checks](docs/gogcli-setup.md#8-verify-the-command-environment); do not use a bot or model request as a setup check.

The release includes `@jl1990/pi-scheduler@0.5.1` for PM, storing native tasks at `~/.battuta/schedule-prompts.json` independently of release directories. Follow [PM scheduler](docs/scheduler.md) for overrides, scopes, catch-up limits, and the **fresh-workspace-only** cutover. Old scheduler settings/jobs are not migrated. Recreate owner reminders explicitly; use global scope when they should survive session or release changes.

Installing the scheduler or running `bin/battuta configure` initializes an empty store but does **not** create the optional nightly memory dream task. After owner approval, follow [nightly PM dream setup](docs/memory-service-setup.md#nightly-pm-dream-setup) with PM stopped. Dream uses a global prompt plus a private status-only tool and latest-due startup catch-up; it can rewrite and retire memories and publish the shared owner profile.

## 6. Optional: run as user services

First run `bin/battuta setup-memory` as the bot login user; the memory setup guide above covers offline provisioning and failure remediation. GitHub's ARM64 build is not Raspberry Pi hardware validation. Setup never restarts bots or migrates old memories.

### Already done?

Ask whether unattended services are wanted. If not, skip this step. Check existing units with `systemctl --user is-enabled battuta-pm.service battuta-tl.service` and `systemctl --user is-active battuta-pm.service battuta-tl.service`. If both are enabled and active, leave them running; do not repeat installation or start a screen session. If units exist but are inactive or point at a different install root, inspect their status and paths before changing them; follow step 7 for a path change. Only install or enable what is missing.

### Fresh setup

Only choose this after interactive login and verification. Check `command -v script` and `systemctl --user status` under the same ordinary user; if either fails, resolve the OS's user-session prerequisites first. Stop the tmux session/bot processes before starting services. From the installation directory, run **without sudo**:

```sh
bin/battuta install-services
systemctl --user daemon-reload
systemctl --user enable --now battuta-memory.service battuta-pm.service battuta-tl.service
systemctl --user status battuta-memory.service battuta-pm.service battuta-tl.service
```

Expect both services to be active/running. If not, inspect `journalctl --user -u battuta-pm.service -f` and the corresponding Tech Lead service logs, fix the cause, and recheck. `install-services` only writes user units; enabling/starting is a separate step. To run services at boot without an interactive login, an administrator can enable linger with `sudo loginctl enable-linger "$USER"`. Never run tmux bots alongside active services.

Make the installed `battuta-project` executable available to both services using the [service PATH instructions](shared-skills/project-context/references/installation.md#bot-service-path); shell PATH changes alone do not apply to systemd units.

Complete the local [Google command-environment checks](docs/gogcli-setup.md#8-verify-the-command-environment) before enabling unattended Google operations.

## 7. Updating an existing installation

### Already done?

This step applies only when the owner requests a newer release or a change of installation path. If the requested version is already installed and the bots work, do not update, replace files, or restart services. If an update is needed, check which mode is currently running and which private files and service units already exist before stopping anything.

### Fresh setup

For a new version or installation path, stop the screen/foreground processes or disable services with `systemctl --user disable --now battuta-pm.service battuta-tl.service` before replacing files. Back up `.env.prod` and both bots' `.pi` state, including `auth.json`, **`mcp-auth.json`**, and sessions, and protect the backups as secrets. Verify the new archive as in step 2. Preserve those private files while updating the same stable path; do not extract over them blindly. For a new root, restore PM's `bots/pm-bot/.pi/mcp-auth.json` with mode `600` **before** configuration or launch, following [OAuth-state migration](docs/luma-setup.md#5-preserve-login-during-release-upgrades). Do not overwrite existing destination credentials. Old installations with no Luma OAuth state require the owner login in step 5 rather than a token migration.

Before configuring a release that previously used `LINEAR_API_KEY`, have the owner rename that setting to `LINEAR_API_TOKEN` in `.env.prod` using a private editor, retaining its value. Apply the shell setup in step 4; if the stable installation path changes, update the shell startup snippets too. For source checkouts, manually rename the setting in `.env` and `supabase/.env` and rerun bot configuration; `make dev` does not migrate credentials.

The release workflow bundles Node selected by the source checkout's `.node-version` and Pi from each bot's pinned manifest. When upgrading from an adapter-based release, retain private auth/session state while using the new release's package manifests and dependencies. `bin/battuta configure` replaces the adapter-specific Linear authentication with an environment-expanded `Authorization` header and removes `pi-mcp-adapter` package entries from retained bot settings. An adapter left enabled would replace Pi's native MCP support. No new Linear token or Linear MCP OAuth login is needed for this migration; Luma's separate owner login is required if no connected grant was retained.

Then run `bin/battuta configure` again to migrate both bots, rerun the local configuration and MCP checks in step 5, and, if using services, run `bin/battuta install-services`, daemon-reload, and enable/start as in step 6.

Reinstall `battuta-project` from the updated release wheels with `--reinstall`. Project registrations live independently under `~/.battuta/projects/`. Shared memory uses `~/.battuta/memory/`; preserve both databases and the capture queue during subsequent updates. This is a breaking replacement with no historical-data migration or cleanup. PM retains read-only loading of its existing `ME.md`; profile-writing tools are removed. Run `bin/battuta setup-memory` before starting the new service. See [cutover and rollback](docs/memory-service.md#breaking-replacement-and-cutover).

The remote Linear webhook also now reads `LINEAR_API_TOKEN`. Before deploying the updated Edge Function, the backend owner must provide that named secret in Supabase. For GitHub Actions deployment, rename the repository secret to `LINEAR_API_TOKEN`; the deployment workflow sets the matching Supabase secret. Confirm the updated webhook works before removing the obsolete `LINEAR_API_KEY` secret.

If the installation path changes, stop/disable all three services first. Generated units use absolute paths; the installer rejects units pointing to another root. Move only the owned Battuta unit files aside before installing from the new path. Existing units from an older release also need to be moved aside explicitly before installing the changed units:

As part of installation migration, update TL's retained `bots/tl-bot/.pi/settings.json` before restarting: `subagents.defaultExtensions` contains an absolute web-access extension path. Replace the old installation prefix with the new one, so the default entry points to `<new-installation-root>/bots/tl-bot/.pi/npm/node_modules/pi-web-access/dist`. Preserve any deliberate custom allowlist entries, updating their paths only if they also moved. Rerunning `bin/battuta configure` preserves this existing setting; it does not repair relocated paths. Leaving the old path can prevent children from loading their web tools. The same manual update is required when moving a source checkout or custom TL workspace.

```sh
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
backup_dir="$unit_dir/battuta-backup-$(date +%Y%m%d%H%M%S)"
mkdir -p "$backup_dir"
mv "$unit_dir/battuta-pm.service" "$unit_dir/battuta-tl.service" "$backup_dir/"
# If installed, also move battuta-memory.service into that backup directory.
# From the new installation directory:
bin/battuta configure
bin/battuta install-services
systemctl --user daemon-reload
systemctl --user enable --now battuta-memory.service battuta-pm.service battuta-tl.service
```

Check both service statuses and bot responses again. Do not move an installation while its services are active.

## Source-checkout Telegram refresh

When running from a source checkout, use the separate Telegram refresh command from the repository root:

```sh
make refresh-telegram ENV_FILE=.env.prod
```

`ENV_FILE` also accepts `.env` or any other environment-file path; it defaults to `.env` when omitted. The command updates both bots' `.pi/telegram.json` with the token, derived bot ID, allowed user ID, and optional username. It does not launch or restart bots. Restart running bots separately to use refreshed settings; `make dev` and `make prod` only launch or reattach sessions.

This Make command requires the source-checkout Python/uv tooling and is not included in the prebuilt archive. For the packaged release, use `bin/battuta configure` as described in step 5.
