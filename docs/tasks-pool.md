# Durable Executor task APIs

Apply the Supabase migrations before calling these PostgREST RPCs at
`POST /rest/v1/rpc/<name>`. Bodies are JSON; successful responses are the task
object (including its current status), or JSON `null` for an empty claim.
Errors are non-2xx PostgREST responses. No worker needs to be online to delegate.

| RPC | JSON arguments |
| --- | --- |
| `delegate_task` | `p_key`, `p_project`, `p_ticket_id`, `p_role` (defaults to `executor`), `p_instruction` |
| `claim_task` | `p_worker_id`, `p_role` (defaults to `executor`) |
| `complete_task` | `p_worker_id`, `p_task_id` |
| `fail_task` | `p_worker_id`, `p_task_id`, `p_reason` |

Keys and worker IDs are opaque, nonempty text, not Pi session IDs. The caller
must retain its worker ID across disposable sessions. An existing claim is
returned before considering role, so changing the requested role cannot strand
owned work. Otherwise the oldest queued task of the requested role is claimed
(creation time, then UUID for ties), skipping locked tasks. Concurrent requests
for the same worker recover the same claim; each worker has at most one claim.

Delegation keys are globally unique. Repeating a key with exactly the same
project, ticket, role and instruction returns the original task, even after it
becomes terminal. Changed payloads are rejected. Required payload fields must
be nonempty; instruction is required even though the SQL signature allows its
omission to support the preceding role default.

Only the owner of a currently claimed task may complete or fail it. Repeating
a terminal transition is rejected. Both terminal states free the worker to
claim again, and neither is returned by future claims. Failure reason is
accepted but **not persisted in V1**. There is no retry, reassignment, timeout,
heartbeat, session tracking, or worker lifecycle management.

Claims use a transaction-scoped advisory lock per stable worker ID plus a
partial unique index allowing only one claimed task per worker. Queue selection
uses `FOR UPDATE SKIP LOCKED`; terminal updates check ownership and claimed
status atomically. Concurrent completion/failure requests have only one winner.
These RPCs use PostgreSQL's default `READ COMMITTED` isolation; callers using
stronger isolation may receive serialization errors. No lock survives the
transaction and no task is automatically reassigned after session loss.

## Trust boundary

Like Agent Mail, these RPCs are restricted to the Supabase `service_role` on
trusted hosts; anonymous and authenticated clients cannot execute them or
access the table. Use the existing server-side Supabase secret-key convention.
Worker ownership is validated against the supplied stable ID, not a per-worker
authenticated principal. A trusted caller with the shared secret can assert
any worker ID; this is not a multi-tenant worker authentication API. The table
is read-only to `service_role`; state transitions go through the RPCs.
The failure reason is not stored in the pool or written by the functions, but
this does not control infrastructure request logging; do not send secrets in it.

Project and ticket are references, not synchronized records. Linear, Git,
GitHub and repository instructions remain authoritative. This pool does not
replace the existing Linear dispatch queue or change Agent Mail addressing.

## Integration tests

Against an **isolated, disposable local Supabase project** with migrations applied
and no pre-existing executor tasks (never production):

```sh
TASKS_POOL_TEST_ISOLATED=1 TASKS_POOL_TEST_URL=http://127.0.0.1:54321 \
  TASKS_POOL_TEST_SECRET_KEY=... \
  TASKS_POOL_TEST_DATABASE_URL=postgresql://postgres:TEST_PASSWORD@127.0.0.1:54322/postgres \
  node --test tests/tasks-pool.database.mjs
```

The test uses Node 22's built-in fetch and test runner, with no package install.
The deterministic held-lock and database privilege subtests additionally require
`psql` on PATH and `TASKS_POOL_TEST_DATABASE_URL` pointing to the **same disposable
database** as the HTTP endpoint. Use a test-only admin login that can lock/read
`tasks_pool`, inspect catalogs, and `SET ROLE` to the existing `anon`,
`authenticated`, and `service_role` roles. The service key is not a SQL admin
credential. Missing database URL skips these two subtests explicitly; supplying
it with missing `psql`, bad credentials, or inadequate privileges fails rather
than silently skipping. No roles or grants are created by the tests.

The held-lock test waits for a separate SQL connection to acknowledge locking
the oldest queued fixture, then awaits an HTTP claim of the next fixture before
rolling back the lock. It verifies the oldest fixture remains queued and can be
claimed after rollback. Locks exist only in the test transaction; error cleanup
disconnects the session, and timeouts bound both SQL and HTTP waits. There are no
production locking hooks or timing sleeps.

The privilege test checks RLS, PUBLIC ACLs, effective table/column privileges,
security-definer flags and RPC execution grants. Transaction-local role switches
exercise SQLSTATE `42501` denials for direct writes by all three client roles and
for table reads/RPC calls by anon/authenticated, plus service-role SELECT.
All SQL is rolled back. This tests PostgreSQL role enforcement, not gateway JWT
validation. PUBLIC is a pseudo-role checked through ACLs, not a login. Database
owners/admins remain privileged; shared-service callers can still assert any
worker ID by design. No per-worker authentication or access policy is added.

Direct SQL URLs accept only literal loopback hosts, explicit user/database, an
explicit nonempty test password, and no query options. Missing or empty passwords
are rejected before spawning `psql`. The child environment pins
`PGPASSFILE=/dev/null` to disable ambient password-file lookup (including
`~/.pgpass`); `psql -X -w` alone does not prevent that lookup. `psql` does not
inherit PG environment settings or startup files.
It skips unless explicitly opted in and rejects non-loopback URLs before making
requests. It does not load application environment files or production credentials.
It creates uniquely named fixtures and intentionally retains them because the
service role cannot delete pool records. Reset the disposable test database
after testing. Do not run against production: the default-role check can claim
existing executor work if the database is not isolated. Coverage includes payload
conflicts (including concurrent conflicting submissions), concurrent delegation
and claims, stable-worker recovery via fresh clients, role filtering/order,
ownership, competing terminal transitions, timestamps and input validation.

Without local Supabase/Docker, `node --check tests/tasks-pool.database.mjs` can
check JavaScript syntax and the test runner can verify the opt-in skip path, but
neither validates SQL execution, database concurrency, grants or PostgREST routing.
Use `node --test tests/tasks-pool.database.mjs` explicitly to check the skip path;
bare `node --test` does not discover this database-test filename.
Run `node --test tests/tasks-pool.psql.test.mjs` for the DB URL safety unit test.
