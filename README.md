# Battuta

Battuta is a team of AI agents working together on software projects.

## Agents Fleet

### PM bot

Helps organize product work and clarify requirements through Telegram. Available for local development.

### Tech-lead bot

Plans the technical approach and breaks work into engineering tasks.

### Engineer bot (WIP)

Implements tasks and makes code changes.

### Review bot (WIP)

Reviews changes and provides feedback before they are accepted.

## Setup

Local setup runs the PM and tech-lead bots together. Install Node.js, pnpm, Python 3.12+, uv, tmux, and the Supabase CLI. Get **two different** Telegram bot tokens from [@BotFather](https://t.me/BotFather), your numeric Telegram user ID, and a Linear API key.

From the repository root:

```sh
cp .env.example .env
cp supabase/.env.example supabase/.env
# Fill in .env and supabase/.env following their respective .env.example files.
supabase start
make setup-bot
make start-dev
```

In each Pi pane, use `/login` to connect your model provider, then message the corresponding bot on Telegram. Each bot has separate Pi state and Telegram credentials; both use the same Linear API key. `make start-dev` opens PM (upper left), tech lead (upper right), and local Supabase functions (bottom) in the `battuta-dev` tmux session; detach with `Ctrl-b d` and run it again to reattach. `make run-dev` remains an alias.

For a remote Supabase project, copy `.env.example` to `.env.prod`, set its `SUPABASE_URL` and `SUPABASE_SECRET_KEY` to the remote project's values, then run `make start-prod`. This opens only the two bot panes in the separate `battuta-prod` tmux session; it does not start local Supabase. Use distinct Telegram bot tokens for dev and prod if running both modes simultaneously. Both modes currently use the same on-disk Pi state for each bot, so do not run them concurrently from the same checkout.

### Raspberry Pi release (64-bit Linux ARM)

Push a `v*` tag whose commit is on `main` to build and publish a GitHub Release containing `battuta-<tag>-linux-arm64.tar.gz` and its SHA-256 checksum. The archive bundles Node and the bots' pinned dependencies; the Pi needs a remote Supabase project with the migrations and functions deployed. The optional screen launcher also needs `tmux`.

Download the archive and checksum from the release page, then on the Pi:

```sh
sha256sum -c battuta-vX.Y.Z-linux-arm64.tar.gz.sha256
tar -xzf battuta-vX.Y.Z-linux-arm64.tar.gz
cd battuta
cp .env.example .env.prod
# Fill in .env.prod with your Telegram, Linear, and remote Supabase credentials.
bin/battuta configure
bin/battuta start-prod-screen
```

Log into your model provider in each Pi pane using `/login`. Detach with `Ctrl-b d`; `bin/battuta start-prod-screen` reattaches. You can also start just one bot in the foreground with `bin/battuta pm` or `bin/battuta tech-lead`; each command uses the same workspace and persistent Pi session as the screen launcher.

For unattended operation, install two separate systemd **user** services from the extracted directory:

```sh
bin/battuta install-services
systemctl --user daemon-reload
systemctl --user enable --now battuta-pm.service battuta-tech-lead.service
systemctl --user status battuta-pm.service battuta-tech-lead.service
```

The installer writes `~/.config/systemd/user/battuta-pm.service` and `battuta-tech-lead.service` with absolute paths to this installation. It uses the Raspberry Pi OS `script` utility to provide the terminal Pi needs in a systemd service. Run it as the Pi user, not with `sudo`. Use `journalctl --user -u battuta-pm.service -f` (or `battuta-tech-lead.service`) for logs. To start user services at boot without an interactive login, an administrator can run `sudo loginctl enable-linger "$USER"`. Stop the `battuta-prod` tmux session before enabling the services, and do not start the screen launcher while the services run: there must be only one Pi process per bot/session. If you move the installation, stop the services, remove the old unit files, reinstall them from the new path, and reload systemd.

Keep the extracted directory (including `.pi` sessions and `.env.prod`) between restarts; save those files before replacing it with a newer release. Do not reuse Telegram tokens with another running instance.

The PM and tech lead share the [agent-mail extension](agent-mail/README.md) for durable, direct communication. Keep one Pi process per role and resume each bot's persistent Pi session after restart.

Bot workspaces live in `bots/pm-bot` and `bots/tech-lead-bot`. Each setup command assembles its runtime `AGENTS.md` from `bots/AGENTS_shared.md` and the bot's `AGENTS_dedicated.md`; rerun setup after changing either instruction file.

## Project registry

Project configuration is stored separately from bot workspaces under
`~/.battuta/projects/<name>/project.yaml`, with shared `MEMORY.md` beside it.
Config and memory are management context for the PM and Tech Lead only; Executors
must not load or read either directly. For delegated work, the Tech Lead supplies
any task-specific instruction needed. Executors use their project directory,
repository `AGENTS.md`, and their own local runtime environment (such as Node or
pyenv).

Run the following management commands from either bot working directory,
`bots/pm-bot` or `bots/tech-lead-bot`, using `cd ../..` to reach the repository
root (replace `my-project` with its registered name):

```sh
cd ../.. && python -c 'from scripts.projects import load_project, read_memory; p = load_project("my-project"); print(p); print(read_memory(p))'
```

The first load can initialize a project by providing a checkout path, for
example `load_project("my-project", Path("/path/to/checkout"))`. The typed
`ProjectConfig` exposes project name/path, optional Linear project/team IDs,
optional GitHub `owner/repository`, and reusable Engineer/Reviewer role names.
The YAML schema has `version: 1`; unsupported versions or fields are rejected.

Shared project memory is stored in that project's `MEMORY.md`. To write it,
explicitly invoke this one-liner from either bot directory:

```sh
cd ../.. && python -c 'from scripts.projects import load_project, write_memory; write_memory(load_project("my-project"), "durable project context\n")'
```

Loading a project never injects
the full memory automatically. Registry config and memory
are durable project context, not mirrors of Linear/GitHub issue or repository
state, ticket handles, or generated `AGENTS.md` files.

Registry access rejects static symlinks that escape the registry/project
directories. These checks and subsequent path operations are not race-free
against a same-UID process that can change filesystem entries between
validation and use; this is not a security boundary against same-user
attackers, who already have direct access to the files. In particular, no
protection against symlink races is claimed. Config and memory files are
created with mode `0600` to avoid granting access to other local users under
ordinary filesystem permissions; this does not restrict their owning UID.
