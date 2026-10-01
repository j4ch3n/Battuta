# Local development

Run all source-checkout commands from the repository root. See the shared [tech stack](../../../../docs/tech-stack.md) for runtime responsibilities and [command reference](../../../../docs/commands.md) for scripts and Make targets.

Run the Project Manager and Tech Lead bots from a source checkout with Python **3.12+**, uv, Node.js **22+**, pnpm **10.20.x**, and tmux. Local Supabase also needs Docker and the Supabase CLI; a remote Supabase project does not.

## Contributor tooling

Install Node.js from `.node-version`, pnpm **10.20.0**, Deno from `.deno-version`, Python **3.12+**, uv, and the Supabase CLI version from `.supabase-version`. Docker must be running for integration checks.

```sh
make setup-checks
```

`make setup-checks` installs locked root tooling and package dependencies, enables the Husky Git hook, and installs Python dependencies. It does not configure or launch the bots. Packages and Edge Functions keep separate lockfiles.

Install the recommended VS Code extensions. Deno language support is scoped to `supabase/functions`, while Prettier handles formatting for both runtimes. Do not run `deno fmt` on Prettier-owned files.

## Bot configuration

For local Supabase, copy `.env.example` to `.env` and `supabase/.env.example` to `supabase/.env`. Restrict both to mode `600` and fill in the two distinct Telegram bot tokens, allowed numeric Telegram user ID, Linear API key, and Supabase URL and server-side secret key. The local functions environment also needs the Linear webhook secret and API key. For remote Supabase development, copy `.env.example` to `.env.prod` instead, restrict it to mode `600`, and set it to the deployed project's URL and secret key. Keep these files out of source control and enter credentials in a private editor rather than chat or shell commands. Optional fields are described in the templates.

For local Supabase, start Docker and run `supabase start`, then copy its URL and server-side secret key into `.env`. For remote Supabase, ensure migrations and Edge Functions have already been deployed.

## Run

```sh
uv sync --locked
make setup-bot
make start-dev
```

`make start-dev` attaches the Project Manager, Tech Lead, and Edge Functions panes; it expects local Supabase to be running already. Use `make start-prod` instead when connecting to remote Supabase with `.env.prod` (it runs the two bots only). Do not run dev and prod modes concurrently from the same checkout; they share Pi state.

Complete `/login` in each Pi pane and finish model-provider authentication, then message both Telegram bots from the allowed user account and confirm each responds. Inspect errors in the panes before declaring setup complete. Detach with `Ctrl-b d` and rerun the same Make target to reattach.
