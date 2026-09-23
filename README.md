# Battuta

Battuta is a team of AI agents working together on software projects.

## Agents Fleet

### PM bot

Helps organize product work and clarify requirements through Telegram. Available for local development.

### Tech-lead bot (WIP)

Plans the technical approach and breaks work into engineering tasks.

### Engineer bot (WIP)

Implements tasks and makes code changes.

### Review bot (WIP)

Reviews changes and provides feedback before they are accepted.

## Setup

Currently, local setup runs the PM bot. Install Node.js, pnpm, Python 3.12+, uv, tmux, and the Supabase CLI. Get a Telegram bot token from [@BotFather](https://t.me/BotFather) and your numeric Telegram user ID.

From the repository root:

```sh
cp .env.example .env
cp supabase/.env.example supabase/.env
# Set PM_TELEGRAM_TOKEN and TELEGRAM_ALLOWED_USER_ID in .env.
# Set the required Supabase values in supabase/.env.
supabase start
make setup-pm-bot
make run-dev
```

In the Pi pane, use `/login` to connect your model provider, then message your bot on Telegram. `make run-dev` opens the PM bot and local Supabase functions in a tmux session; detach with `Ctrl-b d` and run it again to reattach.
