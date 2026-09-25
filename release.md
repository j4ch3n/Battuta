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

Expect `aarch64`/`arm64` and Python **3.12+**. The release bundles Node, Pi, and bot dependencies; it does not require uv, pnpm, Docker, or local Supabase. If Python is missing or too old, arrange a supported Python 3.12+ installation without replacing the OS Python, then recheck. `tmux` is needed for the interactive screen launcher; on Raspberry Pi OS install it if missing with `sudo apt update && sudo apt install tmux`. `script` and working `systemctl --user` are needed only for the optional services in step 6. Check those separately before choosing services; follow the OS's supported user-session setup if unavailable. Do not continue until the tools for the chosen launch method work.

Confirm with the owner that a **remote Supabase project** has already been deployed with Battuta's database migrations and Edge Functions, and that they have two distinct Telegram bot tokens, their numeric Telegram user ID, a Linear API key, and remote Supabase URL and secret key. This archive does not deploy Supabase. If the remote backend is not ready, pause here and arrange its deployment before launching the bots.

## 2. Download and verify the release

### Already done?

Check whether the owner already has the requested version's archive **and matching checksum file**. If so, run the verification command below and reuse them when it reports `OK`; download only missing or invalid files. If the owner has a working installation of the requested version and is not asking to reinstall, skip extraction and proceed to checking its configuration in step 4.

### Fresh setup

Ask the owner which version to install and where to keep it. From the project's GitHub Releases page, download both `battuta-<version>-linux-arm64.tar.gz` and the corresponding `.sha256` into the same directory. Verify the pair **before** extracting:

```sh
sha256sum -c battuta-<version>-linux-arm64.tar.gz.sha256
```

Replace `<version>` with the actual release tag. Expect `OK`; if verification fails, stop and download both files again. The archive includes this `release.md` guide at its root.

## 3. Extract to a stable location

### Already done?

Inspect the intended target before extraction. If `bin/battuta`, `.env.example`, and `release.md` are present, confirm with the owner that this installation is the requested version. If it is, reuse it and continue at step 4; if it is older, use step 7. If the directory exists but is incomplete or its version is unclear, investigate before changing it. Never unpack over an existing installation simply to retry setup.

### Fresh setup

Choose an installation path with no spaces if services may be used. Check whether the target already exists before extracting: if it does, preserve its configuration and Pi state and follow step 7 rather than overwriting it. For a new install at `~/apps/battuta`:

```sh
mkdir -p ~/apps
tar -xzf battuta-<version>-linux-arm64.tar.gz -C ~/apps
cd ~/apps/battuta
test -x bin/battuta && test -f .env.example && test -f release.md
```

Run subsequent commands from this extracted installation directory. If the final check fails, stop and inspect the extraction.

## 4. Prepare production credentials

### Already done?

Check whether `.env.prod` exists and is private (`stat -c '%a' .env.prod` on Raspberry Pi OS). If it exists with mode `600`, ask the owner to confirm that all required values are present and point to the intended services; do not display or replace the file. If it is missing, create it below. If permissions are too broad, restrict them before proceeding.

### Fresh setup

Create the environment file only if absent, and restrict access before the owner fills it in:

```sh
test -e .env.prod || cp .env.example .env.prod
chmod 600 .env.prod
```

Have the owner enter `PM_TELEGRAM_TOKEN`, `TECH_LEAD_TELEGRAM_TOKEN`, `TELEGRAM_ALLOWED_USER_ID`, `LINEAR_API_KEY`, `SUPABASE_URL`, and `SUPABASE_SECRET_KEY` into `.env.prod` using a private editor. The tokens must belong to different bots; the Supabase values must refer to the **deployed remote project**. Optional usernames are described in the template. Do not request credential values in chat, put them in shell commands, or display the file's contents. Ask the owner to confirm all required values are present before continuing.

## 5. Configure and verify interactively

### Already done?

Check whether both bots already have generated instructions and Telegram/MCP configuration (`bots/pm-bot/AGENTS.md`, `bots/tech-lead-bot/AGENTS.md`, and each bot's `.pi/telegram.json` and `.pi/mcp.json`). If configuration is present and the owner confirms credentials have not changed, do not rerun `configure`. Check for an existing tmux session and run `systemctl --user is-active battuta-pm.service battuta-tech-lead.service` before starting anything; an inactive-service result is normal when using tmux. If both bots are already responding to the allowed Telegram user, this step is complete. If services are active, do not start a screen session just to verify them. If only one bot works, troubleshoot that bot without starting duplicates.

### Fresh setup

If configuration is missing or credentials changed, stop any running bots before reconfiguring. Then run:

```sh
bin/battuta configure
bin/battuta start-prod-screen
```

Stop and resolve any configuration error before launching. If configuration was already valid but no bots are running, run only `bin/battuta start-prod-screen`. The screen command opens or reattaches a tmux session with one pane per bot. In **each** Pi pane the owner must run `/login` if not already authenticated and complete model-provider authentication. Send a message to each Telegram bot from the allowed user account and confirm both respond; investigate errors in the running panes before declaring success. Detach with `Ctrl-b d`; rerun `bin/battuta start-prod-screen` to reattach. Alternatively launch one bot in the foreground with `bin/battuta pm` or `bin/battuta tech-lead`. Keep only one process per bot/session.

## 6. Optional: run as user services

### Already done?

Ask whether unattended services are wanted. If not, skip this step. Check existing units with `systemctl --user is-enabled battuta-pm.service battuta-tech-lead.service` and `systemctl --user is-active battuta-pm.service battuta-tech-lead.service`. If both are enabled, active, and responding, leave them running; do not repeat installation or start a screen session. If units exist but are inactive or point at a different install root, inspect their status and paths before changing them; follow step 7 for a path change. Only install or enable what is missing.

### Fresh setup

Only choose this after interactive login and verification. Check `command -v script` and `systemctl --user status` under the same ordinary user; if either fails, resolve the OS's user-session prerequisites first. Stop the tmux session/bot processes before starting services. From the installation directory, run **without sudo**:

```sh
bin/battuta install-services
systemctl --user daemon-reload
systemctl --user enable --now battuta-pm.service battuta-tech-lead.service
systemctl --user status battuta-pm.service battuta-tech-lead.service
```

Expect both services to be active/running. If not, inspect `journalctl --user -u battuta-pm.service -f` and the corresponding tech-lead service logs, fix the cause, and recheck. `install-services` only writes user units; enabling/starting is a separate step. To run services at boot without an interactive login, an administrator can enable linger with `sudo loginctl enable-linger "$USER"`. Never run tmux bots alongside active services.

## 7. Updating an existing installation

### Already done?

This step applies only when the owner requests a newer release or a change of installation path. If the requested version is already installed and the bots work, do not update, replace files, or restart services. If an update is needed, check which mode is currently running and which private files and service units already exist before stopping anything.

### Fresh setup

For a new version or installation path, stop the screen/foreground processes or disable services with `systemctl --user disable --now battuta-pm.service battuta-tech-lead.service` before replacing files. Back up `.env.prod` and both bots' `.pi` state, including auth and sessions, and protect the backups as secrets. Verify the new archive as in step 2. Preserve those private files while updating the same stable path; do not extract over them blindly. Then run `bin/battuta configure` again, verify interactively, and, if using services, run `bin/battuta install-services`, daemon-reload, and enable/start as in step 6.

If the installation path changes, stop/disable services first. Their generated units use absolute paths; the installer rejects units pointing to another root. Move only the two Battuta unit files aside before installing from the new path:

```sh
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
backup_dir="$unit_dir/battuta-backup-$(date +%Y%m%d%H%M%S)"
mkdir -p "$backup_dir"
mv "$unit_dir/battuta-pm.service" "$unit_dir/battuta-tech-lead.service" "$backup_dir/"
# From the new installation directory:
bin/battuta configure
bin/battuta install-services
systemctl --user daemon-reload
systemctl --user enable --now battuta-pm.service battuta-tech-lead.service
```

Check both service statuses and bot responses again. Do not move an installation while its services are active.
