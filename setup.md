# Battuta setup guide

This guide has two independent paths. Follow **A** for source development, or **B** to run the prebuilt 64-bit Raspberry Pi release. Never copy real credentials into tickets or commit environment files.

## A. Source checkout and local development

1. **Check the platform and tools before installing anything.** From the repository root, inspect what is already available:
   ```sh
   python3 --version
   command -v python3 uv node pnpm tmux docker supabase
   node --version 2>/dev/null || true
   pnpm --version 2>/dev/null || true
   tmux -V 2>/dev/null || true
   docker --version 2>/dev/null || true
   supabase --version 2>/dev/null || true
   ```
   Development requires Python **3.12+** (see `pyproject.toml`), `uv`, Node.js **22+**, pnpm **10.20.x**, and tmux. Docker and the Supabase CLI are needed only if running local Supabase. Verify uv explicitly with:
   ```sh
   uv --version
   ```
   A working `systemd --user`/`script` is not needed for development. Do not reinstall tools that already meet these versions.

2. **Install missing or incompatible tools only.** On Debian/Raspberry Pi OS, check `python3 --version` first. Independently check for `uv`; if `command -v uv` finds no executable, install it using the official installer:
   ```sh
   curl -LsSf https://astral.sh/uv/install.sh | sh
   ```
   Open a new shell or add the installer-reported uv bin directory to `PATH`, then verify `uv --version`. Independently, if no suitable Python 3.12+ is available, install a managed Python with `uv python install 3.12`. The locked Python libraries are installed in step A5; do not pip-install project libraries globally. If `curl` is missing, install it with `sudo apt update && sudo apt install curl` on Debian/Raspberry Pi OS.

   Check `node --version` and `command -v node corepack` before installing. Node 22+ is required. If Node is absent or older, use an official supported Node.js installer or a version manager such as the [official Node.js downloads](https://nodejs.org/en/download) (do not assume Debian/Raspberry Pi OS repositories provide Node 22). Check `pnpm --version`; only if it is not already **10.20.x**, activate the required version:
   ```sh
   corepack enable
   corepack prepare pnpm@10.20.0 --activate
   ```
   Avoid reinstalling a compatible pnpm.
   If Corepack is unavailable, use the Node installation's supported Corepack setup; verify `node --version` and `pnpm --version` afterward.

   On Debian/Raspberry Pi OS, if `tmux` is absent, install it with `sudo apt update && sudo apt install tmux`. For other platforms, use the platform's supported package manager. Re-run the checks in step 1 before continuing.

   **Only if you intend to run local Supabase**, check `docker --version`, `docker info`, and `supabase --version` first. Docker must be installed and its daemon running; install Docker only if missing/not usable, following the official [Docker Engine installation instructions](https://docs.docker.com/engine/install/) for your specific distribution (or [Docker Desktop](https://docs.docker.com/desktop/) where supported). The Supabase CLI is also needed only for local Supabase. Install it using the [official installation guide](https://supabase.com/docs/guides/cli/getting-started) for your platform. On macOS, the supported Homebrew route is `brew install supabase/tap/supabase`; elsewhere, follow the guide's platform-specific instructions. The CLI must provide a direct `supabase` executable on your `PATH`: Battuta's `make start-dev` and `run-dev.sh` invoke `supabase` directly, so `npx supabase` is not a substitute. Verify with `command -v supabase` and `supabase --version`. Do not use an unverified OS package for a version-specific CLI. Recheck Docker is running and the CLI works. Do not install Docker or Supabase for release-only usage.

3. **Create local environment files.** Copy the templates without overwriting existing files:
   ```sh
   test -e .env || cp .env.example .env
   test -e supabase/.env || cp supabase/.env.example supabase/.env
   ```
   Restrict both copied files before filling them:
   ```sh
   chmod 600 .env supabase/.env
   ```
   Fill `.env` first with `PM_TELEGRAM_TOKEN`, `TECH_LEAD_TELEGRAM_TOKEN` (two distinct bot tokens from [@BotFather](https://t.me/BotFather)), `TELEGRAM_ALLOWED_USER_ID` (your numeric Telegram user ID), and `LINEAR_API_KEY`; leave `SUPABASE_URL` and `SUPABASE_SECRET_KEY` for step 4, where you fill them from `supabase start` output. Optional bot usernames and agent-mail timing values are documented in the template. `supabase/.env` is for local functions: set `LINEAR_WEBHOOK_SECRET` and `LINEAR_API_KEY` there. Keep both files private; do not commit them.

4. **Start local Supabase (optional only if you are deliberately using remote Supabase).** Ensure the source `.env` and `supabase/.env` files from step 3 are prepared and Docker is running, then run:
   ```sh
   supabase start
   ```
   Wait for the startup summary, then set `.env`'s local Supabase URL and server-side secret key to the values reported (or from `supabase status -o env`). Local database/functions are separate from any remote project.

5. **Install and configure the bots.** From the checkout root run:
   ```sh
   uv sync --locked
   make setup-bot
   ```
   `uv sync --locked` prepares Python and installs the locked development libraries; the Make target uses `uv run --locked`. The commands should finish successfully and each bot should have its generated configuration. Do not pip-install project libraries globally or run bot setup with production secrets in place of local settings.

6. **Start and log in.** First run `supabase start` as described in step 4 to start the local database and API. Then run `make start-dev`; it opens/reattaches the `battuta-dev` tmux session with PM, tech lead, and a third pane serving Edge Functions. `make start-dev` does not run `supabase start`; it expects the local Supabase stack to be running. In each Pi pane run `/login` to authenticate that bot with your model provider, then message the corresponding Telegram bot. Detach with `Ctrl-b d`; run `make start-dev` again to reattach. `make run-dev` is an alias. Each role has separate Pi state and Telegram credentials.

7. **Optional remote-Supabase development.** For a deployed remote Supabase project, safely create `.env.prod` from `.env.example` only if absent, then restrict it before adding credentials:
   ```sh
   test -e .env.prod || cp .env.example .env.prod
   chmod 600 .env.prod
   ```
   Fill its `SUPABASE_URL` and `SUPABASE_SECRET_KEY` with that project's credentials (plus the required Telegram/Linear credentials). `make start-prod` runs only the two bots and does not start local Supabase. Dev and prod share on-disk Pi state in this checkout: do not run both modes concurrently. Prefer distinct Telegram bots if switching/running separate environments.

## B. Raspberry Pi 64-bit release archive and remote Supabase

1. **Check the target.** This archive is for 64-bit Linux ARM (Raspberry Pi OS 64-bit). Check before installing:
   ```sh
   uname -m
   python3 --version
   command -v python3 tmux script systemctl
   systemctl --version 2>/dev/null || true
   tmux -V 2>/dev/null || true
   ```
   Expect `aarch64`/`arm64`. Release project-context commands require Python **3.12+**, the same minimum as source development. If `python3` is missing or older, install Python 3.12+ using your distribution's supported packages or an official Python installation method, and ensure `python3 --version` reports 3.12+ without replacing the OS's system Python. Click and PyYAML are vendored in the archive, so release does not need `uv` or `pip` at runtime and has no library installation step. The archive bundles Node and bot dependencies. `tmux` is needed only for the optional screen launcher; if absent on Debian/Raspberry Pi OS, install with `sudo apt update && sudo apt install tmux`. Optional systemd user services require working `systemctl --user` and `script`; check `systemctl --user status` and `command -v script` before setup. On Debian/Raspberry Pi OS, if `script` is absent, install `util-linux` with `sudo apt update && sudo apt install util-linux`; `systemctl --user` is supplied by systemd, and if unavailable follow the OS's supported systemd/user-session setup rather than installing an arbitrary package. These tools are not prerequisites for foreground use. There is no local Supabase or Docker requirement: deploy migrations/functions to a remote Supabase project separately.

2. **Download and verify the release.** From the project's GitHub Releases page download the matching `battuta-<version>-linux-arm64.tar.gz` and `.sha256` file into the same directory. Verify before extraction:
   ```sh
   sha256sum -c battuta-<version>-linux-arm64.tar.gz.sha256
   ```
   Expected result is `OK`. If verification fails, stop and download both files again. The tar archive includes `setup.md` at its root.

3. **Extract to a stable path.**
   ```sh
   mkdir -p ~/apps
   tar -xzf battuta-<version>-linux-arm64.tar.gz -C ~/apps
   cd ~/apps/battuta
   ```
   Keep the installation path free of spaces if you may use systemd: generated unit files require a path without spaces. The extracted `battuta/` directory includes this guide at its root.

4. **Prepare production credentials.** Create `.env.prod` only if it does not exist:
   ```sh
   test -e .env.prod || cp .env.example .env.prod
   ```
   Restrict the file before filling it:
   ```sh
   chmod 600 .env.prod
   ```
   Set `PM_TELEGRAM_TOKEN` and `TECH_LEAD_TELEGRAM_TOKEN` to two distinct Telegram bot tokens; `TELEGRAM_ALLOWED_USER_ID` to your numeric Telegram user ID; `LINEAR_API_KEY`; and `SUPABASE_URL` plus `SUPABASE_SECRET_KEY` for the **remote deployed** Supabase project. Optional usernames are in the template. Do not put credentials in command history, logs, or source control. Unlike source development's `.env` (local Supabase by default), `.env.prod` is used by release commands and should point to remote Supabase.

5. **Configure and launch interactively.**
   ```sh
   bin/battuta configure
   bin/battuta start-prod-screen
   ```
   Configuration writes private per-bot Telegram/MCP settings and assembles bot instructions. In each Pi pane run `/login` for the model provider. Detach with `Ctrl-b d`; rerun the screen command to reattach. Alternatively run one bot in the foreground with `bin/battuta pm` or `bin/battuta tech-lead`. `tmux` is required only for the screen command. Keep one process per bot/session: do not run screen and systemd processes at the same time.

6. **Optional unattended systemd user services.** Stop the screen session first. From the extracted installation directory, as the ordinary account (never `sudo` for the installer), run `bin/battuta configure` successfully first. The installer command below only writes user-unit files; it does not enable or start services. Only after configure succeeds, deliberately enable and start the two services with the following command sequence:
   ```sh
   bin/battuta install-services
   systemctl --user daemon-reload
   systemctl --user enable --now battuta-pm.service battuta-tech-lead.service
   systemctl --user status battuta-pm.service battuta-tech-lead.service
   ```
   Expected status is active/running. The installer writes user units under `~/.config/systemd/user/`, using absolute paths and Raspberry Pi OS's `script` utility. Follow your OS documentation if `systemctl --user` or `script` is missing; do not substitute guessed package-install commands. View logs with `journalctl --user -u battuta-pm.service -f` (or `battuta-tech-lead.service -f`). To start user services at boot without an interactive login, an administrator may enable linger with `sudo loginctl enable-linger "$USER"`; this optional administrative command is separate from the no-sudo installer.

7. **Stop, update, and back up safely.** Stop services with `systemctl --user disable --now battuta-pm.service battuta-tech-lead.service`, or stop the foreground/screen processes before replacing files. Back up `.env.prod` and each bot's `.pi` state (including auth/session data) before updating; protect those backups as secrets. A release at the same stable path can be updated in place after stopping services; run `bin/battuta configure` and `bin/battuta install-services`, then daemon-reload and enable/start. The installer refuses existing units whose contents point at another install root. If changing paths, stop/disable services first, then move only the two old generated unit files aside before installing from the new path:
   ```sh
   systemctl --user disable --now battuta-pm.service battuta-tech-lead.service
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
   Do not remove unrelated units. Do not move an installation while its generated services are active; the units contain absolute paths. Keep only one running instance per bot and never launch screen alongside active services.

The PM and tech lead share the [agent-mail extension](agent-mail/README.md). Project workspaces are under `bots/`; project registry and shared memory are managed by the project-context skill.
