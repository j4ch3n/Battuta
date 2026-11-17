# Bot setup manifests

Each role owns one `bots/<profile>/bot.toml`. Source setup and release assembly
read the same declarations through `scripts/bot_setup`; releases retain the TOML.
Pi consumes the prepared settings/resources, not the manifest itself.

## Sections

| Section                | Responsibility                                                             |
| ---------------------- | -------------------------------------------------------------------------- |
| `[bot]`                | Role and environment-variable prefix                                       |
| `[skills]`             | Ordered `include` selection from the runtime skill catalog                 |
| `[packages]`           | Pinned Pi package sources and repository-relative Node projects to install |
| `[[extensions]]`       | Named repository-owned extension entry points                              |
| `[[files]]`            | File preparation operations with explicit ownership policy                 |
| `[setup]`              | Ordered, known Python setup steps, restricted by role                      |
| `[runtime]`            | Private `pi_coding_agent_dir`, relative to the fixed private base          |
| `[defaults]`           | Model difficulty tier and initial thinking preference                      |
| `[[subagents.agents]]` | Profile-relative prompt, selected parent skills, and child extensions      |

Node dependency versions remain in `package.json` and lockfiles. Secrets stay in
environment files and private state, never TOML. Browser/MCP configuration and
worker resource ownership retain their specialised validation and merge rules.

The root pnpm workspace owns source dependency resolution and its root lockfile.
Dependencies between local packages use `workspace:*` and named package exports.
The individual package lockfiles are retained separately for standalone release
installations; update and verify them when changing a package's dependencies.
Release builds bundle local workspace imports and omit those bundled dependencies
from the installed package manifests.

## Extension discovery and generated settings

Each profile declares its extensions in TOML:

```toml
[[extensions]]
name = "assignment-worker"
source = "assignment-worker/index.ts"
```

Names are unique lowercase kebab-case. Sources are `.ts` or `.js` repository-relative entry
points inside an owning package directory with its own `package.json` and
`pnpm-lock.yaml`; absolute paths and upward traversal are rejected.

Source setup creates relative links under `bots/<profile>/.pi/extensions/`.
Release assembly uses the same selection to build JavaScript packages in that
directory, including their manifests, lockfiles, and required resources.
Release runtime installation installs each package's locked production
dependencies. No raw extension source or development symlinks ship.

Pi discovers these project-local extensions directly. Neither generated settings
nor launch arguments register them again. MCP and codemode use Pi's built-in
extensions rather than paths into `node_modules`. Third-party Pi packages remain
declared in `[packages].pi` and installed through Pi.

Setup generates each profile's `.pi/settings.json` from its manifest and role
defaults. These files and development extension links are Git-ignored, not
maintained inputs. Re-running setup regenerates profile settings; put personal
preferences in private runtime settings instead. Setup tracks its own extension
links, removes deselected links only while unchanged, and refuses to overwrite
custom extension files or links.

## Worker capabilities

The worker manifest owns base capabilities and named type additions:

```toml
[worker]
capabilities = []

[worker.types.general]
capabilities = ["research"]
```

`BATTUTA_WORKER_1_TYPE=general` selects worker-1 and its type in the environment
file; add numbered entries for other instances. Indices are positive ASCII
integers without leading zeroes; gaps are allowed, and no entries means no workers.
There is no count or separate instance map.

The effective set is the deduplicated union of base and selected type capabilities.
Types do not inherit other types. The `influencer` type selects the separate
`worker-influencer` profile with `mobile-control` and Pi-Droid instead of the
general worker's `research` capability and subagents. All names must exist in
the canonical assignment ability catalog. Unknown types, unknown names and malformed
configuration stop launch. Source and release launchers supply the resolved set as
code-owned JSON; changing it requires restarting the worker. Models do not choose,
register or discover worker capabilities.

## Worker subagents

The worker manifest declares each native subagent:

```toml
[[subagents.agents]]
path = "agents/researcher.md"
inherit_parent_skills = ["research"]
extensions = ["pi-web-access"]
```

Paths are relative to the worker profile. Inherited skills must also be selected
by the parent worker; extension names must be backed by a package in `[packages]`.
Setup renders native `skills` and `extensions` frontmatter into generated agent
definitions, so source prompt files must not declare those keys themselves.
The agent's `tools` restriction remains in the prompt. The researcher requests
web-access tools; the reviewer requests neither skills nor extensions.

Source setup materializes inherited skill files for native subagent discovery;
release bundles include the selected skills and render the same agent definitions.
Generated files are refreshed only when still owned by setup; custom private
agent definitions are preserved.

## Private runtime settings

The base is hardcoded once as `~/.battuta/pi-bots`, expanded using the login user's
home. For example:

```toml
[runtime]
pi_coding_agent_dir = "cos-bot/.pi"

[defaults]
difficulty = "medium"
thinking = "low"
```

Launchers export the resolved absolute directory as `PI_CODING_AGENT_DIR`.
Paths must stay below the base, include an instance-home directory, end in `.pi`,
and have no symlinked ancestors. Worker paths must contain `{instance}`, for
example `{instance}/.pi`, resolved independently for `worker-1`, `worker-2`, etc.
Other template substitutions are rejected. Source worker `--bot-dir` must match
that resolved private home.

Setup and launch create private `settings.json` **only when absent**, before
browser or worker preparation. The file receives `defaultThinkingLevel`, is published atomically without
replacement, and has mode `0600`.

An existing file, including `{}`, is not reformatted or backfilled by the
defaults helper. Invalid JSON, non-regular files and symlinks fail rather than
being repaired. Changing TOML does not update existing preferences; change them
in Pi or edit the private settings explicitly. Other owned setup operations,
such as maintaining private browser settings, still preserve preferences while
updating their own fields. The model is not stored in settings: every launch passes `--model` from the
`MODEL_FOR_<DIFFICULTY>_TASKS` variable (`provider/model-id`) of the manifest's
`difficulty`, so the environment is the single source of truth. When that variable
is unset or empty, no flag is passed and Pi uses its own default. Thinking is not forced.

Current initial defaults:

| Role    | Difficulty | Thinking |
| ------- | ---------- | -------- |
| CoS     | medium     | low      |
| Manager | hard       | medium   |
| Worker  | easy       | high     |

Setup does not authenticate, check provider model availability or invoke a model;
confirm the `MODEL_FOR_*_TASKS` identifiers match the operator's account.

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
- `merge` (JSON `copy` only) creates the target from a template when missing and
  otherwise adds only top-level template keys that are absent. Existing keys are
  never overwritten. Invalid JSON fails before any write.
- `optional = true` skips a rule if an input is missing.
- `context` defaults to `all`; `source` or `release` restricts layout-specific
  rules. Source worker MCP is copied; installed MCP is generated separately.
- Paths are relative, cannot traverse upward, and cannot follow symlinks.
  File operations preflight their selected rules before writing.

### CoS Telegram voice handler

`bots/cos-bot/.pi/telegram.json` is a committed template that holds only the
top-level `outboundHandlers` entry; it contains no credentials. CoS setup and
release merge it into the private `.pi/telegram.json` with the `merge` policy,
then the Telegram step writes `profiles.default` from the environment. A
`make refresh-telegram` run updates only `profiles.default`. Existing top-level
keys are preserved, so hosts that already define `outboundHandlers` keep their
own handler; later template changes are not merged into them.

The handler runs `curl` against the local `POST /tts` route
([speech service](speech-service.md)) and reads the OGG artifact from `{ogg}`.
`curl -f` turns HTTP errors into a command failure, so the bridge falls back to
a text reply. `curl` must be on the Pi process's `PATH`. The default reply mode
stays `manual`; explicit voice requests and `voice.replyMode` use this handler.
The service accepts English text only.

Check the route from the command line before a Telegram test. Expect a non-empty
OGG file and no Telegram or model call:

```sh
printf 'Voice check.' | curl -sf --data-binary @- -H 'Content-Type: text/plain' http://127.0.0.1:8902/tts -o "${TMPDIR:-/tmp}/voice-check.ogg"
test -s "${TMPDIR:-/tmp}/voice-check.ogg" && file "${TMPDIR:-/tmp}/voice-check.ogg"
```

A Telegram receipt is separate evidence. Do not treat a generated or queued file
as confirmed delivery.

## Setup and validation

Setup steps select known Python functions, not shell commands or imports:
CoS supports Telegram, MCP, memory settings, browser and dream provisioning;
Manager supports MCP and memory settings;
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
