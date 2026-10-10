# Task delegation and workers

## Delegate self-contained work

PM/TL invoke `delegate_task` with an immutable versioned instruction:

```json
{
  "key": "example-parser-1",
  "project": "example",
  "ticket_id": "FIS-40",
  "instruction": {
    "schema_version": 1,
    "summary": "Check parser",
    "objective": "Verify parsing of empty input",
    "scope": ["Parser and focused tests"],
    "constraints": ["No Linear lookup/update or network calls"],
    "inputs": [{ "locator": "src/parser.ts", "description": "Parser source" }],
    "acceptance_criteria": [{ "id": "empty", "expectation": "Empty input test passes" }],
    "deliverables": ["Patch and test evidence"]
  }
}
```

Queue acknowledgement means persisted, not started/completed. Auth derives the delegator role; `AGENT_ROLE` selects local credentials but does not grant authority. Identical key/project/ticket/instruction/role retries return the existing task. Conflicting reuse fails. Intentional re-execution requires a new key; do not reset a task. Ticket IDs are traceability only, and multiple tasks can share a ticket. Instructions, not Linear, define execution scope.

## Worker commands

After an operator has verified the already-running compatible service, explicitly launch one daemon:

```sh
# Source checkout, with a private worker-only environment already exported:
node worker-daemon/main.ts --config /absolute/worker.json
# Release installation:
bin/battuta worker --config /absolute/worker.json
```

Bot startup never launches a worker. No worker production service is installed. The daemon uses pinned native `Service.discover()`/`Service.headers()` and `OpenCode.make()`, and refuses an absent/unhealthy/incompatible server before claims. It never starts, stops, replaces or repairs OpenCode.

Each task owns a separate Git worktree, branch and `build` session, even when tickets match. The stable `msg_` prompt identity derives from the task UUID. Claims, binding and final report live in one `tasks_pool` row; no attempts, stored status, lease or local task database. State derives from nullable columns:

- Queued: `claimed_by` is null.
- Running: owner present, `terminal_report` null (includes preparation and questions).
- Completed/failed: report present, using its validated state. Report/time/mail reference commit atomically.

Every unfinished owned row consumes capacity. Realtime private broadcasts/events are wake-up hints; serialized API reconciliation and periodic polling are authoritative. Ownership is global/sticky to the authenticated worker; restarting another worker does not reassign it.

## Results and limitations

Only a completed, quiescent assistant output with the delimited schema-valid `battuta-result` report can finalize. Completion requires each criterion exactly once, passed with evidence, and no unresolved failure. Runtime `succeeded` or idle is not completion. Agent Mail receives a readable, receive-only `worker_result` from `worker.<worker_id>` to the stored PM/TL delegator, without execution IDs in conversational content and without a reply obligation. This is worker-reported completion, not independent review or product acceptance.

Questions preserve session/ownership and remain running; routing answers belongs to FIS-50. Ambiguous claim/session/prompt/report state, permissions or unavailable services stop admission visibly. Inspect owned rows, native inbox/history/forms, worktree and daemon diagnostic before any action. Never requeue, clear ownership, fabricate failure, resend with a new prompt ID, adopt another task's worktree or delete dirty work. Full automated recovery belongs to FIS-51. SIGINT/SIGTERM releases daemon subscriptions/lock only; it does not interrupt native work or stop the shared service.

## Verification commands

`pnpm test:integration` runs one isolated Supabase Docker stack sequentially with real Auth/Edge/DB/mail, real Git and a fake authenticated V2 2.0.24 HTTP server. It exercises the installed native client, not a mocked daemon. It does **not** prove real model execution.

`pnpm smoke:worker` is opt-in paid verification. Use a dedicated small **test** repository containing `README.md`, a single-project capacity-one config with an explicit model, a worker with no unfinished work, and an already-running compatible service. Explicit private environment values are all required:

- `BATTUTA_SMOKE_APPROVAL=test-only-model-spend` and positive `BATTUTA_SMOKE_BUDGET_USD` approved by the owner.
- Absolute `BATTUTA_SMOKE_CONFIG`, `BATTUTA_SMOKE_PROJECT`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`.
- Dedicated `BATTUTA_SMOKE_DELEGATOR_EMAIL`/`BATTUTA_SMOKE_DELEGATOR_PASSWORD` and `WORKER_TASK_EMAIL`/`WORKER_TASK_PASSWORD`.
- `BATTUTA_SMOKE_MAIL_SECRET_KEY`: explicit **test-only** privileged read credential held by the smoke operator, not passed to the worker/model.
- Optional `BATTUTA_SMOKE_DEADLINE_MS` (default 120000; 1000–600000).

The bounded task reads the first README heading and validates completion/mail. Smoke retains its first delegation identity and uses a smoke-local facade issuing **one exact-task claim** (`claim` with optional `task_id`), never an ordinary queue claim. The authenticated API atomically filters task ID, allowed projects and unclaimed ownership before any ownership mutation. Unrelated earlier, later or concurrently queued tasks remain untouched, and the facade refuses all subsequent admissions, even after completion/null/error/deadline. It monitors/binds/finalizes only that task; there is no broad fallback or automatic provisioning. Normal production scheduling remains the unchanged oldest-compatible queue claim.

The backend must include the targeted-claim migration/API update before this smoke is used; older backends fail closed, never fall back to a broad claim. The smoke changes no provider configuration and performs no service lifecycle operation. The budget is an explicit approval/instruction, **not an enforced provider billing cap**: the owner must configure spending controls separately. Deadline stops monitoring, not ongoing execution/spend. Preserve smoke tasks/sessions/worktrees for inspection on failure; never run this against production implicitly or delete dirty smoke worktrees.
