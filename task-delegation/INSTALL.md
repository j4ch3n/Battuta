# Task delegation setup

The release bundles this extension and its frozen production dependencies. Source checkouts use `pnpm --dir task-delegation install --frozen-lockfile`; `make setup-pm-bot` and `make setup-tl-bot` include it. Both launch paths pass `--extension <root>/task-delegation/index.ts` and set `AGENT_ROLE=pm|tl`.

The backend owner must provision **dedicated machine accounts** through Supabase Auth administration, outside bot/daemon execution. Apply the task-pool migration and Edge Function with server-controlled `app_metadata.battuta`:

```json
{ "role": "pm", "projects": ["example"] }
```

Use `tl` for the TL account. Never place authority in user metadata or trust a role supplied by a caller. Restrict each account to intended projects. Test and production accounts, projects and credentials must be distinct.

In the private bot environment, set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and the matching `PM_TASK_EMAIL`/`PM_TASK_PASSWORD` or `TL_TASK_EMAIL`/`TL_TASK_PASSWORD`. These are machine-account passwords, not personal accounts or model-provider credentials. Password login bootstraps signed, refreshable access tokens; tokens are not persisted to a local task ledger. Authentication is lazy on the first `delegate_task` invocation. Check tool discovery without starting duplicate bots; a missing task credential does not disable unrelated bot use.

Workers never receive the bot mail secret or service-role key. Existing bot Agent Mail authentication remains unchanged. Private `task-pool:<project>` broadcasts carry project hints only; authenticated API reads are authoritative. Do not make the queue channel public or expose task instructions in broadcasts.
