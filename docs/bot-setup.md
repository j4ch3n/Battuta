# Bot setup manifests

Each role owns one `bots/<profile>/bot.toml`. Source setup and release assembly
read the same declarations through `scripts/bot_setup`; releases retain the TOML.
Pi consumes the prepared settings/resources, not the manifest itself.

## Sections

| Section      | Responsibility                                                             |
| ------------ | -------------------------------------------------------------------------- |
| `[bot]`      | Role and environment-variable prefix                                       |
| `[skills]`   | Ordered `include` selection from the runtime skill catalog                 |
| `[packages]` | Pinned Pi package sources and repository-relative Node projects to install |
| `[[files]]`  | File preparation operations with explicit ownership policy                 |
| `[setup]`    | Ordered, known Python setup steps, restricted by role                      |
| `[runtime]`  | Private `pi_coding_agent_dir`, relative to the fixed private base          |
| `[defaults]` | Initial provider, model and thinking preferences                           |

Node dependency versions remain in `package.json` and lockfiles. Secrets stay in
environment files and private state, never TOML. Browser/MCP configuration and
worker resource ownership retain their specialised validation and merge rules.
Source and compiled extension paths remain layout-specific Python adapters.

## Private runtime settings

The base is hardcoded once as `~/.battuta/pi-bots`, expanded using the login user's
home. For example:

```toml
[runtime]
pi_coding_agent_dir = "cos-bot/.pi"

[defaults]
provider = "openai"
model = "gpt-6.1-sol"
thinking = "low"
```

Launchers export the resolved absolute directory as `PI_CODING_AGENT_DIR`.
Paths must stay below the base, include an instance-home directory, end in `.pi`,
and have no symlinked ancestors. Worker paths must contain `{instance}`, for
example `{instance}/.pi`, resolved independently for `worker-1`, `worker-2`, etc.
Other template substitutions are rejected. Source worker `--bot-dir` must match
that resolved private home.

Setup and launch create private `settings.json` **only when absent**, before
browser or worker preparation. The file receives `defaultProvider`,
`defaultModel` and `defaultThinkingLevel`, is published atomically without
replacement, and has mode `0600`.

An existing file, including `{}`, is not reformatted or backfilled by the
defaults helper. Invalid JSON, non-regular files and symlinks fail rather than
being repaired. Changing TOML does not update existing preferences; change them
in Pi or edit the private settings explicitly. Other owned setup operations,
such as maintaining private browser settings, still preserve preferences while
updating their own fields. No launch flags force the configured model/thinking.

Current initial defaults:

| Role    | Provider | Model         | Thinking |
| ------- | -------- | ------------- | -------- |
| CoS     | openai   | gpt-6.1-sol   | low      |
| Manager | openai   | gpt-6.1.sol   | medium   |
| Worker  | openai   | gpt-6.1-terra | high     |

Manager's dot spelling is the requested literal value. Setup does not authenticate,
check provider model availability or invoke a model; confirm the model identifier
and provider match the operator's account before first setup.

## File rules

```toml
[[files]]
operation = "concatenate"
sources = [
  { root = "repository", path = "bots/AGENTS_shared.md" },
  { root = "profile", path = "AGENTS_dedicated.md" },
]
target = "AGENTS.md"
destination = "profile"
policy = "replace"
```

- `copy` requires one source; `concatenate` joins text sources with a newline.
- Source roots are `repository` or `profile`. Destinations are `profile` or
  `private` (the private instance home containing `.pi`).
- `replace` refreshes a generated file atomically. `create-only` preserves an
  existing regular file, including custom bytes.
- `optional = true` skips a rule if an input is missing.
- `context` defaults to `all`; `source` or `release` restricts layout-specific
  rules. Source worker MCP is copied; installed MCP is generated separately.
- Paths are relative, cannot traverse upward, and cannot follow symlinks.
  File operations preflight their selected rules before writing.

## Setup and validation

Setup steps select known Python functions, not shell commands or imports:
CoS supports Telegram, MCP, memory settings, browser and dream provisioning;
Manager supports MCP, memory settings and removal of obsolete subagent settings;
Worker uses the specialised worker-profile preparation step.

Use [development commands](commands.md) for configuration/launch and
[skill management](skill-management.md) for selection and staged Git validation.
Filesystem-only checks:

```sh
pnpm check:skills
uv run --project scripts/bot_setup --locked battuta-bot-setup agent-dir --root . --bot cos-bot
pnpm check:support
```

The manifest check must pass, the path command must print the expected absolute
private directory without creating it, and supporting suites must pass using
disposable workspaces/stub executables. These checks do not start bots, invoke
models or validate authentication.
