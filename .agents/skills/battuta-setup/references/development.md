# Local development

Run all source-checkout commands from the repository root. See the shared [tech stack](../../../../docs/tech-stack.md) for runtime responsibilities and [command reference](../../../../docs/commands.md) for scripts and Make targets.

Run CoS and Manager from a source checkout with Python **3.12+**, uv, Node.js from `.node-version` (24 LTS), pnpm **10.20.x**, and tmux. Local Supabase also needs Docker and the Supabase CLI; a remote Supabase project does not.

## Contributor tooling

Before launching bots with shared memory, follow the memory service entry in the [release setup index](../../../../RELEASE.md#extension-and-skill-setup-index). Provisioning uses `bash scripts/setup-memory.sh`; it does not start or restart bots. A source tmux session adds one shared memory window; do not also run a systemd instance on the same data directory/port.

Install Node.js from `.node-version`, pnpm **10.20.0**, Deno from `.deno-version`, Python **3.12+**, uv, and the Supabase CLI version from `.supabase-version`. Docker must be running for integration checks.

For nvm users, run `nvm install` and `nvm use` from the repository root. `.nvmrc` pins the same Node version as `.node-version`, which CI and release packaging consume; update both together when upgrading Node.

```sh
make setup-checks
```

`make setup-checks` installs locked root tooling and package dependencies, enables the Husky Git hook, and installs Python dependencies. It does not configure or launch the bots. Packages and Edge Functions keep separate lockfiles.

Install the recommended VS Code extensions. Deno language support is scoped to `supabase/functions`, while Prettier handles formatting for both runtimes. Do not run `deno fmt` on Prettier-owned files.

## Bot configuration

Use a clean setup, without copying previous-release runtime files or state. For local Supabase, create `.env` from `.env.example` and `supabase/.env` from its example only if absent. Restrict both to mode `600`. Enter CoS's `COS_TELEGRAM_TOKEN`, `TELEGRAM_ALLOWED_USER_ID`, `LINEAR_API_TOKEN`, and the shared Supabase URL/secret key using a private editor; Manager needs no Telegram token. The local functions environment also needs its webhook credentials. For remote development, use `.env.prod` with the deployed project's URL and secret key. Never print secrets or overwrite an existing private environment file to retry setup.

For local Supabase, start Docker and run `supabase start`, then copy its URL and server-side secret key into `.env` using a private editor. For remote Supabase, ensure migrations and Edge Functions, including assignments, have already been deployed. Normal configuration registers assignment MCP for both bots and the worker profile; it never embeds the key value in MCP JSON.

## Run

```sh
uv sync --project scripts/bot_setup --locked
make setup-bot
make dev
```

`make dev` attaches CoS, Manager, and Edge Functions panes; it expects local Supabase to be running already and loads `.env`. Use `make prod` for remote Supabase with `.env.prod`. Launchers do not refresh configuration. Do not run dev and prod concurrently from one checkout; they share Pi state. Source configuration generates manifest-selected relative `.pi/skills/` links locally; these and both session directories are ignored and must not be committed.

To update CoS Telegram separately, run `make refresh-telegram ENV_FILE=.env`; the file can also be `.env.prod` or another path. It updates CoS's profile only, without reinstalling packages, regenerating instructions, or restarting bots. Reattaching does not reload credentials.

Complete model-provider `/login` interactively in each Pi pane when operating the bots. For setup validation, check generated instructions/MCP files for both profiles, CoS's Telegram file, Manager's absence of Telegram package/configuration, and ignored local skill/session paths. Fail on invalid configuration; do not send bot messages or make model requests as setup checks. Detach with `Ctrl-b d` and use the same Make target to reattach.

Pi handles Linear MCP natively. `make setup-bot` writes the environment-expanded `Authorization` header to each bot's `.pi/mcp.json` and removes older `pi-mcp-adapter` package entries from settings. Rerun setup to migrate an existing checkout. The Make setup targets use `.env`; for production credentials, invoke each setup script explicitly:

```sh
uv run --project scripts/bot_setup --locked battuta-bot-setup configure --root . --role cos --env-file .env.prod
uv run --project scripts/bot_setup --locked battuta-bot-setup configure --root . --role manager --env-file .env.prod
```

Restart running bots separately when authorized to load configuration. Validate generated MCP files and credential placeholders without messaging bots or invoking models. Linear and assignments use native `codemode` exposure for tool discovery and calls.
