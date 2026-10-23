# TL bounded child setup

The TL dependency lock installs MIT `pi-subagents@0.81.0` alongside Pi 1.3.0.
The tracked `bounded-subagents` extension adapts its public delegation API; do
**not** also install the unrestricted upstream extension into TL's Pi packages.
PM has neither the adapter nor the dependency. Normal source/release installs
discover TL's tracked extension and existing `use-subagent` skill in place.
Custom source workspaces register the owning checkout's adapter without replacing
existing plugins or skills; keep that checkout at a stable path.

## Operator grant

Delegation is disabled until the operator creates a private
`bots/tl-bot/.pi/subagents.json` (or `subagents.json` in the configured agent
directory). Setup never creates or overwrites this grant, auth or session files.
Use a dedicated, limited provider credential in the TL launch environment,
preferably `BATTUTA_CHILD_API_KEY`, not a PM/TL service credential or copied Pi
`auth.json`. Only the selected API key enters the child environment.

```json
{
  "root": "/absolute/path/to/authorized/project",
  "inputs": ["src/parser.ts", "tests/parser.test.ts"],
  "writable": ["src/parser.ts", "tests/parser.test.ts"],
  "model": "your-openai-compatible-model-id",
  "baseUrl": "https://api.openai.com/v1",
  "apiKeyEnv": "BATTUTA_CHILD_API_KEY",
  "concurrency": 2,
  "maxSpawns": 12,
  "timeoutMs": 120000
}
```

Protect the grant with mode `600`. Restart TL after changing the grant; a session
uses its first validated grant. The endpoint must support OpenAI chat completions
and tool calls. HTTPS is required except for loopback test/local providers. URLs
cannot contain credentials, query strings or fragments. `OPENAI_API_KEY` is also
accepted when deliberately selected. Provider extensions, OAuth and arbitrary
parent authentication are not inherited.

Only exact named files are copied, not directories, Git metadata or hidden files.
There are at most 64 input/writable paths, 256 KiB per input/output file and 2 MiB
of input. Symlinks, traversal and private configuration filenames are rejected.
Each task requests its own exact input and writable subsets; operator grants
cannot be widened by a task. Workers can replace only that task's granted writable files inside their fresh snapshot;
scout/reviewer cannot write. There is no shell or test execution, network research,
MCP, memory/canonical-doc/owner-message authority, nested delegation or automatic
application back to the repository. TL runs checks and integrates separately.
This is a restricted tool boundary, not an OS sandbox against compromised trusted
Node/upstream code or another hostile process under the same OS user.

Limits are per TL session: defaults above; maxima 4 concurrent, 32 lifetime
spawns, 600000 ms. Admission rejects instead of queuing. All calls, including
facade background calls, use upstream foreground delegation inside an owned
private process, so upstream detached ambient-extension inheritance is unused.
Each private HOME/agent directory contains only the selected provider config and
generated profile. Child tool selection is enforced at execution, including
blocking upstream's internally added supervisor-contact tool.

Snapshots/results are session-local and removed on orderly session shutdown or
switch. Parent IPC loss terminates the child; abrupt OS termination can leave
temporary snapshots requiring operator cleanup. Costs are unknown (`null`), not
zero; the adapter has no verified price catalog for arbitrary endpoints.

## Acceptance run-through

Offline CI exercises the real pinned upstream and Pi against a local fake provider
through headless delegation and TL's registered tool. It is **not** live Telegram
or real-provider acceptance. In an operator-authorized deployment, use a disposable
project and limited credential, then record:

1. Ask TL over Telegram to launch one scout and a two-task independent batch.
   Confirm IDs, profile/model, evidence and observed token usage.
2. Launch background review; ask for status, cancel it, and confirm terminal
   cancellation with no remaining owned child process.
3. Use a short deadline and a delayed test endpoint; confirm `timed_out`.
4. Use an invalid dedicated test key; confirm explicit provider failure, not
   completion or fabricated zero usage.
5. Stop/switch TL with active work; confirm children exit and snapshots are removed.
6. Confirm PM has no bounded-subagent tool and existing plugins/private files
   remain unchanged. Never use production credentials merely to satisfy this test.

Real-provider and deployed Telegram acceptance were not performed in the isolated
FIS-116 implementation worktree. They remain deployment acceptance steps.
