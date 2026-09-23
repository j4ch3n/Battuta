# Agent mail

Agent mail lets the PM and tech-lead Pi sessions talk directly. The sender calls `send_agent_message`; Supabase stores the message; the recipient's running Pi extension puts it into that **same Pi conversation** and starts a turn. The model decides what to say next. This does not create another AI session or another Telegram client.

## Run locally

1. Run `supabase start` and `supabase migration up --local`.
2. Set `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in the root `.env`. `supabase status` shows the local URL and modern `sb_secret_...` key.
3. Run `make setup-bot`, then `make run-dev`.

The launcher starts Pi with `--session-id pm` and `--session-id tech-lead`. The extension reads the actual session ID from Pi and uses it as the mail address. These names live in the launcher, not the database schema. Resume those sessions after restarting the bots; run only one process for each address.

## How delivery works

- Each message moves from `created` to `read` when Pi accepts it into its conversation, then to `replied` when a direct reply is stored. A clarification question is a regular reply. The database permits one direct reply per message; more discussion forms a chain.
- A reply reverses the addresses, keeps the conversation ID, and marks its parent replied in one database transaction. A retry with the same idempotency key does not send a second copy.
- Realtime wakes the recipient, while the Supabase table is the durable inbox. The extension also checks for missed messages on startup, reconnect, and every 10 seconds. A renewable database lease prevents two processes from consuming the same address at once.
- PM messages that remain undelivered or unanswered can trigger chase turns. The deadline and repeat interval are configurable in `.env`; database records prevent repeated chase alerts after a restart.

## Boundaries

Pi 0.87 does not return a delivery acknowledgement from `sendMessage`. Agent mail marks a message `read` after Pi emits `message_start` for the injected message, which follows its append to the session. If the process crashes between the append and the database update, the extension checks the saved session entry on restart before injecting it again. Use persistent Pi sessions; a message already marked `read` will not be injected into a different session.

The Supabase **secret key is a project-wide elevated credential**, not an individual bot login. Both bot processes are trusted: the extension takes the sender from Pi's session, but anyone holding the key could call Supabase as another sender or access other project data. Database reply rules still apply to the mail operations, but a session ID alone cannot authenticate a process. Keep the key only in the local, uncommitted `.env` on trusted hosts. If bots must be isolated from each other at the database boundary, they need a separate authenticated gateway.
