# Linear Issue Intake

`linear-webhook` receives Linear Issue webhooks and processes only issues created
directly in a workflow state whose type is `backlog`.

It ignores issue updates, removals, non-Issue webhooks, and issues created outside
Backlog. Linear's HMAC signature and webhook timestamp are validated before any
processing.

For an eligible issue, the function writes one message to the private PGMQ queue
named `engineer_tasks`. The message contains the Linear issue ID, human identifier,
team ID, title, URL, and webhook timestamp, but not the full issue description.

The issue ID is recorded in `linear_issue_dispatches` in the same database
transaction as the queue message, preventing duplicate work from webhook retries.
Only after that transaction succeeds does the function move the Linear issue to
`Todo`.

The queue is created by the Supabase migration and is accessed internally through
the Edge Function's injected `SUPABASE_DB_URL`; it is not exposed through the
Supabase Data API.
