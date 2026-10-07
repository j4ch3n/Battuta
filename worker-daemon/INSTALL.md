# Worker setup

Prerequisites: Node 24.21+, Git, a deployed task-pool backend, dedicated worker Auth account and **already-running OpenCode V2 2.0.24** under the daemon's OS user. OpenCode is not bundled. Complete the release guide's check-first OpenCode step before daemon launch; do not substitute V1 `serve` instructions or daemon-managed startup.

The backend owner provisions server-controlled `app_metadata.battuta` outside execution:

```json
{ "role": "worker", "worker_id": "example-host", "projects": ["example"] }
```

Keep worker identity stable: ownership is sticky, not a lease. Provision different identities/projects for isolated tests and production. Provide only `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `WORKER_TASK_EMAIL`, `WORKER_TASK_PASSWORD` in a mode-600 private environment; no Telegram, Linear, admin/service-role or bot mail credentials are required. Source CLI users export this environment themselves. The release worker wrapper loads `.env.prod` when present; use a worker-only installation/environment rather than distributing the bots' privileged file.

Source dependencies:

```sh
pnpm --dir task-delegation install --frozen-lockfile
pnpm --dir worker-daemon install --frozen-lockfile
```

Release dependencies are bundled. Copy `example.config.json` to a private absolute path and edit it for existing local Git checkouts/commit refs, absolute worktree root, stable worker ID and authenticated provider/model. Never put secrets in JSON. Default capacity is one, reconciliation is 10000 ms. Authority must cover **every** configured project.

All daemon processes for one environment must use the same environment-scoped lock (default hashes `SUPABASE_URL` under `~/.battuta/worker/`). Explicit `lockPath` must not create competing locks. Locks are process coordination, not task state; stale/uncertain locks fail closed. Inspect process ownership before operator removal, never delete a live lock.

This is trusted-host execution: sessions receive wildcard allow permissions, but native hard-denies/pending permissions remain enforced and block admission. The model/tools can read host files and credentials; this is not a sandbox for hostile work. Use an appropriately isolated OS account/host. Never auto-approve native permission requests or weaken shared policies.
