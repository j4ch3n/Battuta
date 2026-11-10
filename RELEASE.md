# Raspberry Pi release setup

Install the prebuilt **64-bit Linux ARM** release as the ordinary user who runs
Battuta. Use exactly `~/battuta/battuta-vX.X.X`, replacing `vX.X.X` with the release
tag. Each version has its own directory. **No backup is required by this process:**
leave the previous installation and shared private data in place; do not delete,
reset, or overwrite them. This is not a database rollback procedure.

Agents perform filesystem, configuration, and service checks only. Stop and report
any failed prerequisite or command; do not improvise recovery. Never print, paste
into chat, or commit secrets. The human owns authentication and functional checks;
agents must not invoke model-provider login, send bot messages, or make model
requests to validate setup.

## 1. Prepare the machine and release

Use 64-bit Raspberry Pi OS with Python **3.12**, uv, `curl`, `script`, and working systemd
user services. Run as the bot user, without sudo:

```sh
uname -m
python3.12 --version
command -v uv curl script systemctl
systemctl --user status
```

Expect `aarch64`/`arm64`, Python 3.12, and a working user service manager. Stop if
anything is unavailable. Node, Pi, and JavaScript runtime dependencies are
bundled; Python tools are separate GitHub Release wheel assets installed with
`uv tool install`. Network access to GitHub and PyPI is required; Python tool
sources and dependency wheelhouses are not in the archive. pnpm, Docker, and
local Supabase are not required. The remote Supabase
database migrations and Edge Functions must already be deployed separately.

Download `battuta-vX.X.X-linux-arm64.tar.gz` and its matching `.sha256` from GitHub
Releases into `~/battuta`. In Bash, set the actual tag and verify before extracting:

```bash
set -euo pipefail
version=vX.X.X
cd "$HOME/battuta"
sha256sum -c "battuta-$version-linux-arm64.tar.gz.sha256"
target="$HOME/battuta/battuta-$version"
if [[ -L "$target" || ( -e "$target" && ! -d "$target" ) ]]; then
  printf 'STOP: release target is not a regular directory.\n' >&2
  exit 1
fi
mkdir -p "$target"
target_contents=$(ls -Aq "$target")
if [[ -n "$target_contents" ]]; then
  printf 'STOP: release directory is not empty, including hidden files. Do not clear it or choose another path.\n' >&2
  exit 1
fi
tar -xzf "battuta-$version-linux-arm64.tar.gz" --strip-components=1 -C "$target"
cd "$target"
test -x bin/battuta && test -f .env.example && test -f RELEASE.md && test -s python-tools-version.txt
```

The checksum must report `OK`; all remaining commands run from this new release
directory in the same Bash session. Create `~/battuta` before downloading if absent.
If the version's target is nonempty, stop—even if it appears already installed.
Do not extract over it. No backup or relocation of the old release is needed.

## 2. Stop the previous deployment and retain configuration

Stopping the previous Battuta services is allowed during this release. If a
previous deployment exists, stop its installed services before copying private
state. Include the worker/artifact units only if installed on that machine:

```sh
systemctl --user stop battuta-cos.service battuta-manager.service battuta-memory.service
# If installed:
systemctl --user stop battuta-worker.service battuta-artifacts.service
```

Stop any old tmux/foreground bot processes too; never run two processes for the
same bot. Before stopping a worker, have the owner confirm it is idle or approve
interrupting its assignment. Restarting does not release an unfinished claim.

For an existing deployment, set `previous` to its exact installation directory.
Copy its private environment, bot `.pi/` configuration/authentication/session
files, and generated instructions into the new release. Do not display them.
Keep the **new** bundled `.pi/npm` packages and `.pi/extensions` runtime code;
do not copy generated `.pi/skills` discovery links, which may still point into
the previous installation:

```bash
previous="$HOME/battuta/battuta-vPREVIOUS"
test -d "$previous" && test "$previous" != "$target"
umask 077
if [[ -f "$previous/.env.prod" ]]; then
  cp -p "$previous/.env.prod" .env.prod
fi
for bot in cos-bot manager-bot worker; do
  if [[ -d "$previous/bots/$bot/.pi" ]]; then
    tar -C "$previous/bots/$bot" --exclude='.pi/npm' --exclude='.pi/extensions' --exclude='.pi/skills' -cf - .pi |
      tar -C "bots/$bot" -xf -
  fi
  if [[ -f "$previous/bots/$bot/AGENTS.md" ]]; then
    cp -p "$previous/bots/$bot/AGENTS.md" "bots/$bot/AGENTS.md"
  fi
done
```

For a first installation, skip copying. If the previous production worker used a
private directory instead of `bots/worker`, copy its `.pi/` and instructions from
that instance into the new `bots/worker` instead. Preserve private files; never
copy one bot's authentication into another bot.

Retain any custom local skills/extensions separately after confirming they are
not bundled runtime code or links into the previous installation. Leave the
original files untouched; stop if their ownership or required paths are unclear.

Check retained settings/resource paths locally without displaying secrets. Relative
paths must resolve in the new release; absolute paths and custom discovery links
must not load code from the old release. Stop and report incompatible or stale
configuration rather than silently running old code. Shared memory, scheduler,
projects, and artifacts under the bot user's HOME stay in place; do not copy or
reset their databases.

## 3. Prepare credentials and application components

Reuse the copied `.env.prod` when present. Otherwise create it privately:

```sh
test -e .env.prod || cp .env.example .env.prod
chmod 600 .env.prod
```

Have the owner fill missing values in a private editor: `COS_TELEGRAM_TOKEN`,
`TELEGRAM_ALLOWED_USER_ID`, `LINEAR_API_TOKEN`, `SUPABASE_URL`, and
`SUPABASE_SECRET_KEY`, plus any optional values their components require. Confirm
the Supabase values refer to the intended remote production backend. Never ask
for credential values in chat.

Load the environment without shell tracing, then install **all five Python
tools** from the same GitHub Release. Keep affected services stopped: uv tools
are shared by this user across release directories. The wheel version combines
the release tag and short commit SHA, for example `0.2.5+gabc1234`; read the exact
value bundled in `python-tools-version.txt`, not a guessed hash or `latest`.

Download and verify the wheels and tested dependency constraints outside the
bot release directory, then install them into uv-managed environments:

```bash
set -a
source .env.prod
set +a
tool_version="$(cat python-tools-version.txt)"
release="https://github.com/j4ch3n/Battuta/releases/download/$version"
tools="$HOME/battuta/python-tools/$version"
mkdir -p "$tools"
cd "$tools"
curl --fail --location --output python-tools-SHA256SUMS "$release/python-tools-SHA256SUMS"
curl --fail --location --output python-tools-version.txt "$release/python-tools-version.txt"
for package in battuta-project battuta-artifacts battuta-memory battuta-bot-setup battuta-packaging; do
  wheel="${package//-/_}-$tool_version-py3-none-any.whl"
  curl --fail --location --output "$wheel" "$release/$wheel"
  curl --fail --location --output "$package-constraints.txt" "$release/$package-constraints.txt"
done
sha256sum -c python-tools-SHA256SUMS
cmp python-tools-version.txt "$target/python-tools-version.txt"

uv tool install --reinstall --managed-python --python 3.12 --no-build \
  --constraint battuta-project-constraints.txt "./battuta_project-$tool_version-py3-none-any.whl"
uv tool install --reinstall --managed-python --python 3.12 --no-build \
  --constraint battuta-artifacts-constraints.txt "./battuta_artifacts-$tool_version-py3-none-any.whl" \
  --with "./battuta_project-$tool_version-py3-none-any.whl"
uv tool install --reinstall --managed-python --python 3.12 --no-build \
  --constraint battuta-memory-constraints.txt "./battuta_memory-$tool_version-py3-none-any.whl"
uv tool install --reinstall --managed-python --python 3.12 --no-build \
  --constraint battuta-bot-setup-constraints.txt "./battuta_bot_setup-$tool_version-py3-none-any.whl"
uv tool install --reinstall --managed-python --python 3.12 --no-build \
  --constraint battuta-packaging-constraints.txt "./battuta_packaging-$tool_version-py3-none-any.whl" \
  --with "./battuta_bot_setup-$tool_version-py3-none-any.whl"
export PATH="$(uv tool dir --bin):$PATH"
for command in battuta-project battuta-artifact battuta-memory battuta-bot-setup battuta-packaging; do
  "$command" --help >/dev/null
done
cd "$target"
bin/battuta setup-memory
bin/battuta setup-artifacts
```

Every download, checksum, installation, and help command must succeed; otherwise
stop before provisioning or service activation. Third-party dependencies come
from PyPI at the exported constraints. `--with` supplies the same-release Battuta
dependency inside the tool's isolated environment; a separately installed global
CLI does not satisfy another tool's Python imports.

uv also accepts wheel URLs directly, for example
`uv tool install --python 3.12 "$release/battuta_artifacts-$tool_version-py3-none-any.whl" --with "$release/battuta_project-$tool_version-py3-none-any.whl"`.
That shorthand omits the explicit checksum and constraints verification above;
use the verified procedure for deployment. No PyPI publication of Battuta tools
is needed, and setup must not install them from release source directories.

These setup commands provision application data but do not start bots. Memory setup
also provisions the verified ONNX model; see its setup guide for offline input.
Use the same HOME and any data-directory overrides as the previous deployment.
Artifact setup applies required database migrations; leaving the old release in
place does not undo shared database changes.

Complete the applicable component setup from the index below. Reuse existing
configuration rather than reinstalling or regenerating what is already present.
Keep `.env.prod` as the credential source. Standalone terminals need their own
environment loading; services load it through the release launcher.

## 4. Configure only missing bot files

If both CoS and Manager already have `AGENTS.md`, `.pi/settings.json`, and
`.pi/mcp.json`, and CoS has `.pi/telegram.json`, **skip** `bin/battuta configure`.
Only CoS may select the Telegram package. If required configuration is missing,
run:

```sh
bin/battuta configure
```

If `bots/worker/AGENTS.md`, `bots/worker/.pi/settings.json`, and
`bots/worker/.pi/mcp.json` are present, **skip** worker configuration. Otherwise run:

```sh
bin/battuta configure-worker
```

The production worker service uses `bots/worker` as its private instance; it does
not use or start the development worker at `~/.battuta/workers/worker-1`.
Retained configuration must match the intended credentials/endpoints. If the
owner changed them, update the affected configuration before starting services.

## 5. Install and start all three bots and application services

From the new release root, install the five user units:

```sh
bin/battuta install-services --replace
```

`--replace` explicitly replaces existing regular Battuta unit files so they point
at this release. It does not start, stop, or enable services. Symlinked units are
refused. If existing units have custom edits, stop and ask the owner before
replacing them; existing systemd drop-ins remain in effect and must also be
checked for references to the previous release.

Generated units set an explicit PATH using `uv tool dir --bin`, making both
`battuta-project` and `battuta-artifact` available to **all three bot services**.
Check that retained custom PATH drop-ins do not override it with an old tool path.
Keep the bots stopped during PATH setup. **Before starting, obtain the owner's
approval to execute queued production work:** the worker can immediately claim
available assignments. Then start the new deployment:

```sh
systemctl --user daemon-reload
systemctl --user enable --now battuta-memory.service battuta-artifacts.service \
  battuta-cos.service battuta-manager.service battuta-worker.service
systemctl --user status battuta-memory.service battuta-artifacts.service \
  battuta-cos.service battuta-manager.service battuta-worker.service
```

Expect all five services to be active/running. Stop and report failed units with
sanitized status/logs; do not invoke a model or message bots to diagnose setup.

To run after logout/at boot, an administrator may enable lingering for this user
with `sudo loginctl enable-linger "$USER"`. Do not run tmux bots alongside these
services. Leave the previous release directory intact; no backup step is needed.

## 6. Hand functional checks to the human

Ask the owner to perform these checks themselves and report any problem:

- Send a message to CoS in Telegram and confirm a reply.
- Open the Telegram model menu and confirm the expected models are available.
- Confirm the intended provider/model access for Manager and Worker through their
  normal operator interface. The agent must not launch a second instance or run
  login checks.
- When ready, authorize a suitable worker assignment and confirm that it is
  claimed and that its result reaches Manager. Do not manufacture production work
  solely to validate installation.

Service status proves process startup, not functional acceptance. Report setup
as awaiting human checks until the owner confirms them. Human messages/model
selection are acceptance actions, not agent-run setup validation.

## Extension and skill setup index

Use these owning guides for applicable application components. Authentication and
functional acceptance belong to the human; agents do not run those checks.

| Component                                                      | Setup                                                                                                                                                                                         |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pi, CoS/Manager extensions, agent mail, project-spec, Telegram | Bundled; retain configuration or generate missing files in step 4. Remote Supabase is deployed separately.                                                                                    |
| Shared memory MCP and client                                   | [Memory service setup](docs/memory-service-setup.md); provision before starting services.                                                                                                     |
| Artifact service and CLI                                       | [Artifact service setup](docs/artifact-service-setup.md).                                                                                                                                     |
| Project-management skill and `battuta-project`                 | [Project-management installation](skills-hub/project-management/references/installation.md), including service PATH.                                                                          |
| Assignment/TODO MCP and notes                                  | [Assignment MCP setup](docs/assignments-setup.md); notes use built-in local file tools.                                                                                                       |
| Worker profile and execution skills                            | [Worker setup](docs/workers-setup.md); this release installs one optional worker user service.                                                                                                |
| Manager native Pi subagents                                    | [Subagent setup](docs/subagents-setup.md).                                                                                                                                                    |
| Google management CLI                                          | [Google CLI setup](docs/gogcli-setup.md); owner-managed account access.                                                                                                                       |
| Luma integration                                               | Bundled configuration; retain private `.pi/` state. Owner-managed account access.                                                                                                             |
| CoS scheduler and optional nightly memory dream                | [Scheduler](docs/scheduler.md) and [nightly dream setup](docs/memory-service-setup.md#nightly-cos-dream-setup). Dream requires separate owner approval; release setup does not activate it.   |
| Runtime skills                                                 | One bundled `skills-hub/` catalog with per-role selections; see [skill management](docs/skill-management.md).                                                                                 |
| Additional Pi packages / OpenCode contributor tooling          | Source-checkout workflows only: [Pi extensions](https://github.com/j4ch3n/Battuta/blob/main/docs/pi-extensions.md), [OpenCode](https://github.com/j4ch3n/Battuta/blob/main/docs/opencode.md). |

## Source-checkout launch and Telegram refresh

`make prod` launches/reattaches source-checkout production tmux using `.env.prod`;
it does not build, publish, or install a release, and does not start a worker.
To refresh only CoS Telegram configuration from a source checkout:

```sh
make refresh-telegram ENV_FILE=.env.prod
```

Restart affected bots separately. This Make command requires source tooling and
is not an archive command; releases use retained configuration or
`bin/battuta configure` when configuration is missing.

## Returning to an older release

Changing the bot release directory does **not** restore the user's Python tools.
Before returning to an older release that uses this wheel-based process, stop
affected services and reinstall all five tools using that release's wheel
version, checksums, and constraints from step 3; replace the units to target its
directory. Do not use `uv tool upgrade` to discover newer GitHub tags. Retain the
same HOME, private configuration, and shared data paths, and run only provisioning
compatible with the selected version before obtaining approval to restart.

Artifact database migrations and memory model/data changes are not reversed by
reinstalling an old wheel. Stop if the older version cannot read the current
schema/model; recovery requires a separate reviewed data-restoration procedure.
For older archives that bundled Python tooling, follow that version's guide and
review compatibility explicitly rather than mixing installation models.
