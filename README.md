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
make run-dev
```

In each Pi pane, use `/login` to connect your model provider, then message the corresponding bot on Telegram. Each bot has separate Pi state and Telegram credentials; both use the same Linear API key. `make run-dev` opens PM (upper left), tech lead (upper right), and local Supabase functions (bottom) in a tmux session; detach with `Ctrl-b d` and run it again to reattach. If an older two-pane session is running, stop it before running `make run-dev` to get the new layout.

The PM and tech lead share the [agent-mail extension](agent-mail/README.md) for durable, direct communication. Keep one Pi process per role and resume each bot's persistent Pi session after restart.
