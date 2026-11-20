# Worker Claude Code delegation setup

Workers delegate planning, implementing and review to headless Claude Code runs through
`pi-harness-delegate@0.9.0`. Each run is a separate Claude Code session on the worker host.
See [workers](workers.md) for how a worker uses it.

## Prerequisites

- The `claude` binary on the worker's `PATH`, signed in by the host operator. This is a
  new credential: keep it private and out of releases.
- `MODEL_FOR_EASY_TASKS`, `MODEL_FOR_MEDIUM_TASKS` and `MODEL_FOR_HARD_TASKS` set to
  `anthropic/<model-id>` (for example `anthropic/claude-haiku-5-5`), using Claude Code's
  dashed ids. A tier that is unset or not Anthropic is shown to the worker as unavailable.

## Source installation

Run the normal worker setup; it installs the pinned package and creates the `implement`,
`research`, `review` and `plan` templates under the worker's private
`.pi/delegate/templates/claude/` when missing. Existing templates are left unchanged;
to pick up a source change, move the private file aside and rerun setup.

```sh
uv run --project scripts/bot_setup --locked battuta-bot-setup configure --root . --role worker
```

## Claude Code skills

The worker manifest's `[claude] skills` list names skills that setup copies from the skill catalog (independent of the
bot's own skill selection) into Claude Code's user directory, `~/.claude/skills/` (or `$CLAUDE_CONFIG_DIR`
when set), so every delegated run on the host can use them. Files already present are left
unchanged; to pick up a source change, move the host copy aside and rerun setup. Research
runs use the `research` template, which names the `research` skill.

## Document service

Main-bundle worker configuration also registers the shared `battuta-doc` MCP server in Claude
Code's user configuration (timeout 1020000 ms, above the service's 15-minute blocking cap) when it
is not already registered; an existing entry is kept. The server is never added to a Pi
`.pi/mcp.json`. See [document service setup](doc-service-setup.md).

## Working directory for assignment runs

The worker manifest lists `pi-harness-delegate` under `[packages] pi_library`: Pi installs it but does not
load its own extension. The worker extension loads it instead and runs its `delegate` tool with the
assignment's project as the working directory, for every harness. The tool's optional `cwd` (an absolute
path) selects one of:

- the project's registered code folder, `~/.battuta/projects/<project>/code`, which must be a real
  directory next to a `project.yaml` (the default when `cwd` is omitted);
- a worktree that `git worktree list` shows for that code folder;
- the bound assignment's work folder, `~/.battuta/projects/<project>/work/<assignment_id>`.

Any other folder is refused before anything starts. A resumed session (`sessionId`) must belong to the
bound assignment and runs in the folder where it started.

Every run also gets these directories pre-approved, so edits and path-checked commands in them need no
permission request. Entries are resolved to real paths, and entries missing on the host are skipped, so
one list serves Linux hosts and macOS development hosts. `XDG_*` variables are not read.

| Directory                                          | Why                                                                        |
| -------------------------------------------------- | -------------------------------------------------------------------------- |
| The project code folder                            | A worktree's git data lives there, so commits from a worktree write to it. |
| The assignment work folder                         | Deliverables the assignment produces, whatever the run's folder.           |
| `os.tmpdir()`, `/tmp`, `/var/tmp`                  | Temporary files from test runners, build tools and Claude Code.            |
| `/dev/shm`, `/run/user/<uid>`                      | Linux shared memory and per-user runtime files (sockets, locks).           |
| `~/.cache`, `~/.local/share`, `~/.npm`             | Linux tool caches and stores (`uv`, `pip`, Playwright, `pnpm`, `npm`).     |
| `/private/tmp`, `/var/folders`, `~/Library/Caches` | The macOS equivalents, for development hosts.                              |

Everything else in the package behaves as documented: modes and templates (including the worker's own,
where `{{cwd}}` is that folder), run records, transcripts and budgets. `/delegate` typed by a person
still runs in the worker's own directory. A session that is not bound to an assignment, or a project or
folder that cannot be validated, fails before anything starts; no default directory is used. A bot
without the package, such as the influencer, has no `delegate` tool.

The harness loads the folder's own configuration: Claude Code reads its `CLAUDE.md` (or `AGENTS.md` when
neither the folder nor any directory above it has a `CLAUDE.md`), `.claude/` settings, hooks and agents. That
configuration runs with the worker's privileges, so register only projects the host operator trusts.
Claude Code also reads `CLAUDE.md` from every directory above the working directory, so none should
exist in `~/.battuta/projects`, `~/.battuta` or the home directory: it would apply to every project.

The worker extension loads the package installed in its own bot profile (`.pi/npm/node_modules/pi-harness-delegate/`)
and wraps the `delegate` and deprecated `claude_delegate` tools by name. If the package is missing or fails to
load, the worker logs an error naming the path and registers no delegation tools. Recheck both after changing the
package pin.

## How runs execute

The worker starts Claude Code through a small proxy shipped beside its extension
(`dist/claude-proxy.js` in a release, `assignment-worker/claude-proxy.ts` from source), which the
package runs in place of the `claude` executable. The proxy takes the same arguments and prints the same
stream output, and connects back to its own worker. A `delegate` call returns once the run has started.
The worker keeps working while the run continues, and receives its questions, permission requests and
result as messages. Each worker runs at most one Claude run at a time. `/delegate` typed by a person has
no worker to answer it, so any request that needs approval is denied at once, as with `claude -p`.

## Permissions

Runs use the `edit` tier for implementing and `readonly` for planning and review.

- A readonly run never edits files, whatever the worker answers.
- A request that is not pre-approved goes to the worker. Examples are a shell command that Claude Code
  does not allow, a folder outside the pre-approved list, web access, or a question from Claude.
- An unanswered request is denied after 10 minutes, and the run continues with its best judgment.
- Extra directories that a model passes in `addDirs` outside the run's folder are refused at once,
  because no one is there to confirm them.

Project-level Claude settings are ignored for an untrusted workspace, so to pre-approve
commands the host operator must add them to the user-level Claude Code settings or trust
the worker workspace deliberately. `danger` is never used by workers.

## Installation checks: no model calls

```sh
command -v claude && claude --version
test -f bots/worker/.pi/npm/node_modules/pi-harness-delegate/package.json
grep -q '"extensions": \[\]' bots/worker/.pi/settings.json
test -f "$HOME/.battuta/pi-bots/worker-1/.pi/delegate/templates/claude/implement.md"
test -f "$HOME/.battuta/pi-bots/worker-1/.pi/delegate/templates/claude/review.md"
test -f "$HOME/.battuta/pi-bots/worker-1/.pi/delegate/templates/claude/plan.md"
test -f "$HOME/.battuta/pi-bots/worker-1/.pi/delegate/templates/claude/research.md"
test -f "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/research/SKILL.md"
```

Missing output means setup is incomplete; stop rather than starting workers. For releases,
inspect the equivalent files inside the installation, plus the worker's Claude proxy, from the
installation root:

```sh
test -f bots/worker/.pi/extensions/assignment-worker/dist/claude-proxy.js
```

## Separate manual functional check

With normal worker authentication and a test-only assignment, confirm that the worker runs
an implement delegation, then a separate fresh review delegation with specific objectives,
and reports from their summaries. Do not use production assignments for this check.
