# Local development

Run the PM and tech-lead bots from a source checkout with Python **3.12+**, uv, Node.js **22+**, pnpm **10.20.x**, and tmux. Local Supabase also needs Docker and the Supabase CLI; a remote Supabase project does not.

## Configure

For local Supabase, copy `.env.example` to `.env` and `supabase/.env.example` to `supabase/.env`. Restrict both to mode `600` and fill in the two Telegram bot tokens, allowed Telegram user ID, Linear API key, and Supabase credentials. The local functions environment also needs the Linear webhook secret and API key. For remote Supabase development, copy `.env.example` to `.env.prod` instead, restrict it to mode `600`, and set it to the deployed project's URL and secret key. Keep these files out of source control. The [release guide](release.md#4-prepare-production-credentials) describes the production credential fields in more detail.

For local Supabase, start Docker and run `supabase start`, then copy its URL and server-side secret key into `.env`. For remote Supabase, ensure migrations and Edge Functions have already been deployed.

## Run

```sh
uv sync --locked
make setup-bot
make start-dev
```

`make start-dev` attaches the PM, tech-lead, and Edge Functions panes; it expects local Supabase to be running already. Use `make start-prod` instead when connecting to remote Supabase with `.env.prod` (it runs the two bots only). Do not run dev and prod modes concurrently from the same checkout; they share Pi state.

Complete `/login` in each Pi pane, then message both Telegram bots. Detach with `Ctrl-b d` and rerun the same Make target to reattach. See the [release guide](release.md#5-configure-and-verify-interactively) for a more detailed verification walkthrough.
