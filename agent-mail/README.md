# Agent mail

Role-addressed JSON communication between the Project Manager (`pm`) and Tech Lead (`tech-lead`). The recipient's running Pi extension injects incoming JSON into its current context and starts a turn. One agent runs per role; there is no inbox lock or lease.

## Contracts and ownership

| Layer | Owns |
| --- | --- |
| LLM (`schemas.ts`) | Destination role or parent reference, `chat`/`chase`, `{content: string}`, and explicit `reply_expectation: null \| {window: short/medium/long}`. |
| Pi adapter | `Value.Check()` then `Value.Parse()` and a final check; sender role from `AGENT_ROLE`; Pi UUID for new sends; window-to-minute translation; Edge Function invocation and JSON delivery. |
| Edge Function (`supabase/functions/agent-mail`) | Secret-key authentication, strict transport validation, and send/reply/read RPC dispatch. |
| PostgreSQL RPCs | Short message IDs, reply validation/locking, inserts, status transitions, conversation inheritance, and database-time deadlines. |

The adapter translates short/medium/long to 5/10/20; no expectation becomes a null offset. It never calculates absolute deadlines. The RPC stores `response_due = created_at + offset`, using database time and `timestamptz`. Offsets are transport fields, not database columns.

### LLM tool arguments

`send_agent_message`:

```json
{"recipient":"tech-lead","message_type":"chat","content":{"content":"Please review this design."},"reply_expectation":{"window":"medium"}}
```

`reply_agent_message`:

```json
{"parent":{"conversation_id":"550e8400-e29b-41d4-a716-446655440000","id":"a7c91e3b4d62"},"message_type":"chat","content":{"content":"The design looks good."},"reply_expectation":null}
```

Both tools are registered with Pi. Normal tool calls already contain the complete typed intent, including the reply expectation; the wrapper does not run a second LLM call to infer metadata.

For direct completion, `/agent-mail <instruction>` uses the active Pi model's `modelRegistry.complete()` with these same two tool schemas and recent incoming mail. `completion.ts` extracts exactly one completed tool-call block and validates its arguments before submission. Plain text, unknown/multiple tools, invalid arguments, and error/aborted/truncated completions are rejected. Pi completion returns an assistant message, not an automatically validated typed object.

### Adapter → Edge Function

Send payload: `operation: "send"`, `sender_role`, `recipient_role`, `conversation_id`, `message_type`, `content`, `response_due_minutes: null | 5 | 10 | 20`.

Reply payload: `operation: "reply"`, `sender_role`, `parent: {conversation_id, id}`, `message_type`, `content`, `response_due_minutes`. No recipient or current Pi session ID is sent for a reply.

Read payload: `operation: "read"`, `recipient_role`, `message_ref: {conversation_id, id}`.

The function returns `{data: storedMessage}` for sends/replies or `{data: boolean}` for acknowledgements. It calls `agent_mail_send`, `agent_mail_reply`, or `agent_mail_read`; these RPCs perform the actual writes. SQL role columns are text, not enums. `message_type` is the PostgreSQL enum `chat | chase` (default `chat`).

### Supabase → recipient

```json
{
  "message_ref": {"conversation_id":"550e8400-e29b-41d4-a716-446655440000","id":"b8d02f4c5e73"},
  "in_reply_to": {"conversation_id":"550e8400-e29b-41d4-a716-446655440000","id":"a7c91e3b4d62"},
  "sender":"tech-lead",
  "recipient":"pm",
  "message_type":"chat",
  "content":{"content":"The design looks good."},
  "created_at":"2026-09-30T12:00:00Z",
  "response_due":null
}
```

Root messages have `in_reply_to: null`. Reply to the current `message_ref`, not its `in_reply_to`.

## Identity, persistence, and delivery

- `AGENT_ROLE=pm|tech-lead` is the stable address. Pi creates its own UUID; it must not equal the role.
- New messages use the sender's current Pi UUID. All sends from that session share a conversation ID. Replies inherit their parent's UUID and reverse roles. Primary key and reply references use `(conversation_id, id)`; IDs are random 12-character hexadecimal hashes, with collision retries in SQL.
- Launchers use `--continue --session-dir <bot>/.pi/mail-sessions`: first launch creates a UUID session; later launches resume it. This separate directory avoids legacy role-named sessions. Already-read messages are not injected into a different session.
- Realtime wakes the role inbox. Reconciliation runs on startup/reconnect and every 10 seconds. Session changes refresh delivery state and new sends use the active context's UUID.
- `created → read` occurs when Pi accepts the custom message into its conversation, not on socket receipt. Saved branch entries prevent reinjection after append-before-ack crashes. Failed acknowledgements retry while the process remains live.
- Replies require a read parent, inherit its conversation, and mark it replied in one transaction. One direct reply is permitted per parent; subsequent dialogue replies to the newest relevant message.
- No idempotency keys or automatic send/reply retries. An ambiguous transport failure may have committed. Read acknowledgements and inbox reconciliation remain retryable.
- No mail leases, chase claims, or automatic chasing. Nullable deadlines and the `chase` type prepare future scheduling.

## Run and verify locally

1. `supabase start` and `supabase migration up --local`.
2. Run `supabase functions serve agent-mail` (or serve all functions with the existing development command).
3. Set `SUPABASE_URL` and modern `SUPABASE_SECRET_KEY` in the root `.env`.
4. Run `make setup-bot`, then `make run-dev`.

Checks:

```sh
pnpm --dir agent-mail check
pnpm --dir agent-mail test
pnpm --dir agent-mail test:integration
deno check --config supabase/functions/agent-mail/deno.json supabase/functions/agent-mail/index.ts
```

TypeScript tests are registered as separate `unit` and `integration` Vitest projects. Integration tests use local Supabase credentials from `supabase status -o json` unless supplied explicitly, reject remote URLs, and need the mail Edge Function running. Run against an isolated local instance without active bots.

## Deployment and trust

Apply the forward migration before deploying the updated Edge Function and runners. Mail tables are assumed empty; the migration replaces them without copying historical rows. Existing deployment automation deploys all functions. `verify_jwt = false` is paired with `@supabase/server`'s `auth: "secret"`, which checks the `apikey` header; the endpoint is not public. Standard Supabase secret-key environment variables are provisioned by the platform/CLI.

Both agents are trusted holders of the elevated Supabase secret key. Roles are routing labels, not individual authentication identities. Service-role access and RLS remain as before; a key holder can impersonate another role. Keep credentials on trusted hosts in uncommitted environment files.
