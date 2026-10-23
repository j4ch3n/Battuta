# Bounded child tools

`bounded_subagents` accepts `action: launch`, `status` or `cancel`.

```json
{
  "action": "launch",
  "background": true,
  "tasks": [
    {
      "profile": "scout",
      "objective": "Find the parsing boundary",
      "inputs": ["src/parser.ts"],
      "scope": "Local source only; do not change files",
      "evidence": "Relevant symbols, paths, risks and missing context"
    }
  ]
}
```

Use `profile: worker` for snapshot edits or `reviewer` for independent findings.
All four task fields are required. `inputs` is an exact subset of the operator's
read grant; only those files enter this task's snapshot. Workers must also name
the exact `writable` paths they need, a subset of the operator's write grant.
Other profiles cannot request writable paths. `scope` describes additional
assignment constraints; it never expands these enforced file/tool grants.
Batches are admitted atomically and
reject rather than queue if concurrency or the session spawn budget is exhausted.

Foreground calls wait for results. Background calls return IDs immediately and
later deliver terminal evidence to TL. Inspect using
`{"action":"status","ids":["child-id"]}` (omit IDs to list this session).
Stop using `{"action":"cancel","ids":["child-id"]}`; cancellation waits for
the owned process to exit. Parent session switch/shutdown stops children and
removes their snapshots. IDs and results are not durable across parent restarts.

Results identify the profile, objective, private workspace, model, upstream status,
evidence and observed usage. Cost is `null`: this adapter has no verified price
catalog for the configured endpoint. Missing usage is unavailable, never proof
of zero usage. Timeout, provider rejection and missing terminal evidence are not
successful work. Keep required patches/evidence before session shutdown.
Failed-run usage is omitted because upstream may normalize unavailable provider
usage to zero counters; do not treat it as zero billing.
