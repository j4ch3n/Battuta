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

A worker's Claude Code run for an assignment starts with `delegate_claude_assignment` (not the
generic `delegate` tool, which is blocked for `harness` `claude`). Its working directory is:

- the worktree the assignment brief supplies, when the worker passes it as `worktree`
  (an absolute path, a real directory, a git worktree of the same repository as the project
  code folder, listed by `git worktree list`, and not inside another project's folder); otherwise
- the project's registered code folder, `~/.battuta/projects/<project>/code`, which must be a
  real directory next to a `project.yaml`.

So a run loads that folder's `CLAUDE.md`, `.claude/` settings, agents, skills and plugins.
Claude Code also loads the folder's `AGENTS.md`, but only as a fallback when neither the folder nor
any directory above it has a `CLAUDE.md` or `CLAUDE.local.md` (the folder case observed with Claude
Code 2.1.327; the ancestor rule is from the official documentation). A project that has a `CLAUDE.md` does not also
get its `AGENTS.md` loaded unless `CLAUDE.md` imports it. The user-level `~/.claude` configuration
(or `$CLAUDE_CONFIG_DIR`) is shared by every run on the host; it is not isolated per project.

Battuta does not itself scan or block the ancestor folders of a run's working directory. Claude Code
does: it loads `CLAUDE.md` and `CLAUDE.local.md` from the working directory and every directory above
it at launch ([Claude Code memory documentation](https://code.claude.com/docs/en/memory); a live probe
on Claude Code 2.1.327 read a parent's `CLAUDE.md` from a child working directory). For a project code
folder, the ancestors are `~/.battuta/projects/<project>`, `~/.battuta/projects`, `~/.battuta`, the home
directory and above. On 2026-11-19 none of them contained a `CLAUDE.md` (checked read-only; `/etc/claude-code`
has none either). Adding one there would be loaded by every project's runs and would break project
isolation, so project instructions belong in the project's code folder only.

The Claude routing block is a routing rule, not an enforcement boundary. The worker's `bash` tool can
still run `claude` directly in any directory; the tool hook blocks only the generic `delegate` and
the deprecated `claude_delegate` alias for Claude. See [workers](workers.md) for the trust boundary.

A run whose folder or worktree cannot be validated fails before Claude starts, with a message
naming the project and the folder or worktree; no default directory is used. Manual `/delegate`
use and scheduled runs are unchanged. Other harnesses keep using the generic `delegate` tool.

## Permissions

Runs use the `edit` tier for implementing and `readonly` for planning and review. `edit` maps to
Claude Code's `acceptEdits` mode, which is pending owner confirmation. A
shell command Claude Code does not pre-approve (for example `npm`) is denied and the run
continues; the worker sees it in the run's permission denials and reports a blocker.
Project-level Claude settings are ignored for an untrusted workspace, so to pre-approve
commands the host operator must add them to the user-level Claude Code settings or trust
the worker workspace deliberately. `danger` is never used by workers.

## Known limitations

- The `edit` tier (`acceptEdits`) is pending owner confirmation; see Permissions above.
- A non-zero Claude exit after a parsed result is treated as a failure and the report is dropped
  (cost, permission denials, working directory). Files may already have changed in edit mode, so
  check the checkout before retrying; the error includes the session id.
- The output-overflow stop kills only the Claude process, not its children, so tool processes it
  started may keep running.
- The spawned Claude process inherits the worker's environment, including any `GIT_*` variables such
  as `GIT_DIR` or `GIT_WORK_TREE`. Only Battuta's own working-directory git checks use a sanitized
  environment.
- The Claude tool is registered only when the `delegate` tool is already present at session start.
  This was verified for Pi 1.5.2; no test runs real Pi, so a loader change would not be caught.

## Installation checks: no model calls

```sh
command -v claude && claude --version
test -f bots/worker/.pi/npm/node_modules/pi-harness-delegate/package.json
test -f "$HOME/.battuta/pi-bots/worker-1/.pi/delegate/templates/claude/implement.md"
test -f "$HOME/.battuta/pi-bots/worker-1/.pi/delegate/templates/claude/review.md"
test -f "$HOME/.battuta/pi-bots/worker-1/.pi/delegate/templates/claude/plan.md"
test -f "$HOME/.battuta/pi-bots/worker-1/.pi/delegate/templates/claude/research.md"
test -f "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/research/SKILL.md"
```

Missing output means setup is incomplete; stop rather than starting workers. For releases,
inspect the equivalent files inside the installation.

## Separate manual functional check

With normal worker authentication and a test-only assignment, confirm that the worker runs
an implement delegation, then a separate fresh review delegation with specific objectives,
and reports from their summaries. Do not use production assignments for this check.
