# Raspberry Pi release setup

This guide is for installing the prebuilt **64-bit Linux ARM** Battuta release on Raspberry Pi OS. An agent helping with installation should work through the steps in order on the target machine. At each step, first perform its **Already done?** check and skip actions that are already complete; inspect results before proceeding, explain any failure, and ask the owner for credentials or interactive authentication when needed. Never print, paste into chat, or commit secrets. Do not assume a command succeeded merely because it was issued.

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

Expect `aarch64`/`arm64` and Python **3.12+**. The release bundles Node, Pi, and bot dependencies; it does not require pnpm, Docker, or local Supabase. Project-context tooling requires uv, Git, and GitHub CLI; its bundled wheels target Python **3.12** on Linux ARM64. Install it using the [project-context installation reference](shared-skills/project-context/references/installation.md) before project work. If Python is missing or too old, arrange a supported installation without replacing the OS Python, then recheck. `tmux` is needed for the interactive screen launcher; on Raspberry Pi OS install it if missing with `sudo apt update && sudo apt install tmux`. `script` and working `systemctl --user` are needed only for the optional services in step 6. Check those separately before choosing services; follow the OS's supported user-session setup if unavailable. Do not continue until the tools for the chosen launch method work.

Confirm with the owner that a **remote Supabase project** has already been deployed with Battuta's database migrations and Edge Functions, and that they have two distinct Telegram bot tokens, their numeric Telegram user ID, a Linear API key, and remote Supabase URL and secret key. This archive does not deploy Supabase. If the remote backend is not ready, pause here and arrange its deployment before launching the bots.

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

Install `battuta-project` from the included wheels as described in the [installation reference](shared-skills/project-context/references/installation.md). Verify GitHub authentication as the bot user; defer `battuta-project --help` until step 4 has made the required Linear token available.

## 4. Prepare production credentials

### Already done?

Check whether `.env.prod` exists and is private (`stat -c '%a' .env.prod` on Raspberry Pi OS). If it exists with mode `600`, ask the owner to confirm that all required values are present, including `LINEAR_API_TOKEN`, and point to the intended services; do not display or replace the file. If it is missing, create it below. If permissions are too broad, restrict them before proceeding. Also check token availability from a new terminal as described below; an existing bot's environment does not establish that other sessions have the token.

### Fresh setup

Create the environment file only if absent, and restrict access before the owner fills it in:

```sh
test -e .env.prod || cp .env.example .env.prod
chmod 600 .env.prod
```

Have the owner enter `PM_TELEGRAM_TOKEN`, `TL_TELEGRAM_TOKEN`, `TELEGRAM_ALLOWED_USER_ID`, `LINEAR_API_TOKEN`, `SUPABASE_URL`, and `SUPABASE_SECRET_KEY` into `.env.prod` using a private editor. The tokens must belong to different bots; the Supabase values must refer to the **deployed remote project**. Linear MCP and `battuta-project` use the same `LINEAR_API_TOKEN`. Optional usernames are described in the template. Do not request credential values in chat, put them in shell commands, or display the file's contents. Ask the owner to confirm all required values are present before continuing.

### Make the Linear token available across Battuta sessions

Keep `.env.prod` as the single credential source. The release foreground commands, both production tmux panes, and both user services load it and export its variables before starting Pi. Their child commands inherit `LINEAR_API_TOKEN`; this does not export the token back into other terminals on the machine.

For standalone Pi sessions and `battuta-project` commands under the same OS user, add this snippet once to both `~/.profile` (login shells) and `~/.bashrc` (interactive Bash shells) using an editor. If `~/.bash_profile` or `~/.bash_login` exists, ensure it sources `~/.profile` or put the login-shell snippet there instead. Replace the example path with the actual stable installation path. If the user uses another shell, configure its equivalent startup file instead.

```sh
if [ -r "$HOME/apps/battuta/.env.prod" ]; then
  LINEAR_API_TOKEN="$(
    unset LINEAR_API_TOKEN
    . "$HOME/apps/battuta/.env.prod"
    printf '%s' "${LINEAR_API_TOKEN:-}"
  )"
  export LINEAR_API_TOKEN
fi
```

The subshell reads the private file but exports only the Linear token to the terminal; the other production credentials stay inside the subshell. Use the same shell-compatible assignments as the environment template and keep tracing (`set -x`) disabled when loading credentials. Do not copy the token into startup files or make `.env.prod` world-readable.

Open a new terminal under the bot user and verify without printing the token:

```sh
test -n "${LINEAR_API_TOKEN:-}" && printf 'Linear token is available\n'
battuta-project --help
```

If the first command does not print the confirmation, resolve the environment setup before continuing. Run these checks in any standalone Pi session used for Battuta as well. Existing shells and Pi processes retain their old environment: reopen standalone sessions and restart running bots after setup or rotation. For production tmux, stop the bot session and launch it again; reattaching does not reload credentials. Systemd services load `.env.prod` through the release launcher, so they do not depend on shell startup files.

## 5. Configure and verify interactively

### Already done?

Check whether both bots already have generated instructions and Telegram/MCP configuration (`bots/pm-bot/AGENTS.md`, `bots/tl-bot/AGENTS.md`, and each bot's `.pi/telegram.json` and `.pi/mcp.json`). Confirm that each Linear MCP entry has `headers.Authorization` set to the literal `Bearer ${LINEAR_API_TOKEN}` and `exposure` set to `codemode`, and that neither bot's `.pi/settings.json` includes `pi-mcp-adapter`. If configuration is present, uses this native format, and the owner confirms credentials have not changed, do not rerun `configure`. Check for an existing tmux session and run `systemctl --user is-active battuta-pm.service battuta-tl.service` before starting anything; an inactive-service result is normal when using tmux. If both bots are already responding to the allowed Telegram user and native Linear MCP works, this step is complete. If services are active, do not start a screen session just to verify them. If only one bot works, troubleshoot that bot without starting duplicates.

### Fresh setup

If configuration is missing, still uses the adapter format, or credentials changed, stop any running bots before reconfiguring. Then run:

```sh
bin/battuta configure
bin/battuta start-prod-screen
```

Stop and resolve any configuration error before launching. If configuration was already valid but no bots are running, run only `bin/battuta start-prod-screen`. The screen command opens or reattaches a tmux session with one pane per bot. In **each** Pi pane the owner must run `/login` if not already authenticated and complete model-provider authentication. Send a message to each Telegram bot from the allowed user account and confirm both respond; investigate errors in the running panes before declaring success. Detach with `Ctrl-b d`; rerun `bin/battuta start-prod-screen` to reattach. Alternatively launch one bot in the foreground with `bin/battuta pm` or `bin/battuta tl`. Keep only one process per bot/session.

Pi provides MCP natively. In each pane, use `/mcp` to confirm Linear is connected, then ask the bot for a read-only Linear lookup. With `codemode` exposure, Linear tools are discovered and called through native codemode; their names use `mcp__linear__<tool>`. For connection diagnostics without starting another bot session, load `.env.prod` as in step 4 and run the bundled CLI from each bot directory:

```sh
(cd bots/pm-bot && PI_CODING_AGENT_DIR="$PWD/.pi" ../../bin/node node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js mcp list)
(cd bots/tl-bot && PI_CODING_AGENT_DIR="$PWD/.pi" ../../bin/node node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js mcp list)
```

Expect Linear to be connected with tools listed; a nonzero exit indicates invalid configuration or a connection failure. Pi 1.0.0 uses fullscreen TUI by default; set `tuiMode` to `regular` in bot settings if terminal scrollback is preferred.

## 6. Optional: run as user services

### Already done?

Ask whether unattended services are wanted. If not, skip this step. Check existing units with `systemctl --user is-enabled battuta-pm.service battuta-tl.service` and `systemctl --user is-active battuta-pm.service battuta-tl.service`. If both are enabled, active, and responding, leave them running; do not repeat installation or start a screen session. If units exist but are inactive or point at a different install root, inspect their status and paths before changing them; follow step 7 for a path change. Only install or enable what is missing.

### Fresh setup

Only choose this after interactive login and verification. Check `command -v script` and `systemctl --user status` under the same ordinary user; if either fails, resolve the OS's user-session prerequisites first. Stop the tmux session/bot processes before starting services. From the installation directory, run **without sudo**:

```sh
bin/battuta install-services
systemctl --user daemon-reload
systemctl --user enable --now battuta-pm.service battuta-tl.service
systemctl --user status battuta-pm.service battuta-tl.service
```

Expect both services to be active/running. If not, inspect `journalctl --user -u battuta-pm.service -f` and the corresponding Tech Lead service logs, fix the cause, and recheck. `install-services` only writes user units; enabling/starting is a separate step. To run services at boot without an interactive login, an administrator can enable linger with `sudo loginctl enable-linger "$USER"`. Never run tmux bots alongside active services.

Make the installed `battuta-project` executable available to both services using the [service PATH instructions](shared-skills/project-context/references/installation.md#bot-service-path); shell PATH changes alone do not apply to systemd units.

## 7. Updating an existing installation

### Already done?

This step applies only when the owner requests a newer release or a change of installation path. If the requested version is already installed and the bots work, do not update, replace files, or restart services. If an update is needed, check which mode is currently running and which private files and service units already exist before stopping anything.

### Fresh setup

For a new version or installation path, stop the screen/foreground processes or disable services with `systemctl --user disable --now battuta-pm.service battuta-tl.service` before replacing files. Back up `.env.prod` and both bots' `.pi` state, including auth and sessions, and protect the backups as secrets. Verify the new archive as in step 2. Preserve those private files while updating the same stable path; do not extract over them blindly.

Before configuring a release that previously used `LINEAR_API_KEY`, have the owner rename that setting to `LINEAR_API_TOKEN` in `.env.prod` using a private editor, retaining its value. Apply the shell setup in step 4; if the stable installation path changes, update the shell startup snippets too. For source checkouts, manually rename the setting in `.env` and `supabase/.env` and rerun bot configuration; `make dev` does not migrate credentials.

The release workflow bundles Node selected by the source checkout's `.node-version` and Pi from each bot's pinned manifest. When upgrading from an adapter-based release, retain private auth/session state while using the new release's package manifests and dependencies. `bin/battuta configure` replaces the adapter-specific Linear authentication with an environment-expanded `Authorization` header and removes `pi-mcp-adapter` package entries from retained bot settings. An adapter left enabled would replace Pi's native MCP support. No new Linear token or MCP OAuth login is needed for this migration.

Then run `bin/battuta configure` again to migrate both bots, verify native MCP and Telegram interactively as in step 5, and, if using services, run `bin/battuta install-services`, daemon-reload, and enable/start as in step 6.

Reinstall `battuta-project` from the updated release wheels with `--reinstall`. Project registrations and memory live independently under `~/.battuta/projects/`; retain them across release updates.

The remote Linear webhook also now reads `LINEAR_API_TOKEN`. Before deploying the updated Edge Function, the backend owner must provide that named secret in Supabase. For GitHub Actions deployment, rename the repository secret to `LINEAR_API_TOKEN`; the deployment workflow sets the matching Supabase secret. Confirm the updated webhook works before removing the obsolete `LINEAR_API_KEY` secret.

If the installation path changes, stop/disable services first. Their generated units use absolute paths; the installer rejects units pointing to another root. Move only the two Battuta unit files aside before installing from the new path:

```sh
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
backup_dir="$unit_dir/battuta-backup-$(date +%Y%m%d%H%M%S)"
mkdir -p "$backup_dir"
mv "$unit_dir/battuta-pm.service" "$unit_dir/battuta-tl.service" "$backup_dir/"
# From the new installation directory:
bin/battuta configure
bin/battuta install-services
systemctl --user daemon-reload
systemctl --user enable --now battuta-pm.service battuta-tl.service
```

Check both service statuses and bot responses again. Do not move an installation while its services are active.

## Source-checkout Telegram refresh

When running from a source checkout, use the separate Telegram refresh command from the repository root:

```sh
make refresh-telegram ENV_FILE=.env.prod
```

`ENV_FILE` also accepts `.env` or any other environment-file path; it defaults to `.env` when omitted. The command updates both bots' `.pi/telegram.json` with the token, derived bot ID, allowed user ID, and optional username. It does not launch or restart bots. Restart running bots separately to use refreshed settings; `make dev` and `make prod` only launch or reattach sessions.

This Make command requires the source-checkout Python/uv tooling and is not included in the prebuilt archive. For the packaged release, use `bin/battuta configure` as described in step 5.
