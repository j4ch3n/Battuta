# Oracle Linux ARM64 release design

Status: approved design; implementation plan awaiting review. Implementation is
not authorized by this document alone.

Ticket: [FIS-151](https://linear.app/fiscumco/issue/FIS-151).

Implementation plan: [FIS-151 release implementation](../plans/2026-11-10-fis-151-arm64-release.md).

## Objective

Install Battuta on an OCI Ampere A1 machine running Oracle Linux 9 (AArch64),
with nvm and uv already set up but no existing Battuta deployment. Deliver
generated bot instructions, selected skills, and compiled
extensions separately from Python server and CLI wheels. Keep all credentials
and mutable bot state outside the replaceable installation.

This is a fresh-install design, not a migration design. Do not discover previous
deployments, copy old bot directories, translate historical settings, or implement
legacy compatibility rules. Unexpected or incompatible existing state causes a
sanitized error and requires a human decision.

## Agreed constraints

- Remove Raspberry Pi references from the README and release instructions. Describe
  OCI Ampere A1, Oracle Linux 9, and Linux ARM64 explicitly.
- The bot archive contains a single `bots/` tree. No runtime `skills-hub/` catalog.
- Generate each role's `AGENTS.md` and selected skill bundle during the build.
- Ship compiled JavaScript extensions, not their original TypeScript sources.
- Do not bundle Node, JavaScript runtime dependencies, or Python environments.
- Install JavaScript dependencies inside the installation, never in private bot
  state. Install Python tools from the matching release's wheels.
- Python release wheels describe their complete pinned runtime dependencies in
  standard wheel metadata. Do not publish separate constraint files.
- Keep CoS, Manager, and every worker's private state in flat, separate bot homes.
- `WORKER_BOT_COUNT` selects numbered workers. Local bots run in individual tmux
  panes; production defaults to services with explicit foreground maintenance.
- Prefer complete generation of deployment-owned configuration over merging.
- Setup must not start bots, invoke models, authenticate providers, or send messages.

## Release assets

GitHub Releases publishes:

```text
battuta-vX.Y.Z-linux-arm64.tar.gz
battuta-vX.Y.Z-linux-arm64.tar.gz.sha256
battuta_project-<tool-version>-py3-none-any.whl
battuta_artifacts-<tool-version>-py3-none-any.whl
battuta_memory-<tool-version>-py3-none-any.whl
battuta_bot_setup-<tool-version>-py3-none-any.whl
battuta_packaging-<tool-version>-py3-none-any.whl
python-tools-version.txt
python-tools-SHA256SUMS
```

Retain the current tag-plus-commit wheel versioning and same-release dependency
installation. `python-tools-SHA256SUMS` covers the five wheels and Python tool
version file. Do not resolve Battuta tool versions from `latest` or install their
sources. Dependency pins travel inside each wheel, not in separate release assets.

The bot archive's release metadata identifies the release tag, commit, exact Python
tool version, required Node version, and required package-manager version. Derive
versions from their maintained repository sources rather than duplicate constants.

## Self-describing Python wheels

### Standard wheel mechanism

A wheel is a ZIP archive containing code, entry points, and a
`<distribution>-<version>.dist-info/METADATA` file. Python installers read its
standard `Requires-Python` and repeated `Requires-Dist` fields to determine which
dependencies to install. `Requires-Dist` supports exact version requirements,
environment markers, extras, and direct HTTPS wheel references.

For example, a release wheel's metadata has this shape (versions and URLs here
are illustrative, not additional maintained pins):

```text
Metadata-Version: 2.3
Name: battuta-artifacts
Version: 0.2.5+gabc1234
Requires-Python: >=3.12
Requires-Dist: click==8.1.8
Requires-Dist: battuta-project @ https://github.com/j4ch3n/Battuta/releases/download/v0.2.5/battuta_project-0.2.5+gabc1234-py3-none-any.whl
```

The actual metadata must include the entire applicable runtime dependency closure,
not just the example entries or direct dependencies. Listing a transitive package
as an exact `Requires-Dist` requirement also constrains that package when the
installer resolves another dependency's broader requirements. Conflicting
requirements cause installation to fail; the installer must not loosen pins.

An embedded `constraints.txt` or `uv.lock` file has no equivalent automatic effect:
installers do not treat arbitrary wheel resources as dependency constraints. No
custom installer, post-install hook, or runtime dependency resolver is required.

### Build-time metadata generation

1. Keep each project's checked-in `uv.lock` as the version source. Verify it is
   consistent with its project metadata, without updating or re-resolving it during
   release assembly. Keep development dependency ranges unchanged in source.
2. Export/select that project's production dependency closure for the supported
   Python 3.12 / Oracle Linux 9 ARM64 environment. Exclude development/test groups,
   the project itself, and local/editable source requirements. Include runtime
   dependencies introduced by requested extras. Preserve relevant environment
   markers and extras; do not strip them by parsing requirement lines naively.
3. Generate exact `name==version` release requirements for every third-party
   package in that closure. No unpinned dependency may remain applicable in the
   supported target environment. Do not claim these target-tested pins provide
   compatibility guarantees for other Python versions or operating systems.
4. Replace local Battuta dependency references with direct wheel URLs for the exact
   release tag and tool version. In particular, artifacts references the matching
   project wheel, and packaging references the matching bot-setup wheel. Include
   the internal dependencies' third-party closure as well. Shared requirements
   must agree; fail the build on incompatible lockfile pins instead of selecting
   a new version or silently allowing a different release.
5. Supply the generated requirement list through a release-only build metadata
   hook in the owning Python projects' existing Hatchling build backend. The hook
   replaces the release wheel's dependency metadata before wheel assembly. Share
   generation logic under `scripts/packaging/`; do not maintain five manually
   pinned dependency lists or edit checked-in project files for every release.
   If Hatchling requires dependencies to be declared dynamic for this hook, use
   release-only staging metadata with that declaration; do not leave both static
   and dynamic dependency declarations in the build input.
   Preserve project names, entry points, Python requirements, and required notices.
6. Inspect the built wheels' final `METADATA`, not just the generation input.
   Reject applicable ranges, local paths, editable requirements, wrong-version
   Battuta references, or missing runtime pins. Build through the backend so wheel
   `RECORD` hashes are generated correctly; do not patch wheel ZIP contents after
   building without regenerating their integrity metadata.

These remain code-only `py3-none-any` wheels where their own contents are pure
Python. Native third-party wheels are downloaded separately for the target;
pinning their version does not make them architecture-independent.

### Operator installation

The installation interface is one uv tool command per top-level tool wheel:

```sh
uv tool install --managed-python --python 3.12 "<release-wheel-url>"
```

Use exact URLs from the selected release. uv reads the wheel metadata, resolves
its pinned third-party requirements and same-release Battuta URLs, creates an
isolated environment, and exposes its declared commands. Do not require
`--constraint`, `--with`, a source checkout, or a separately downloaded lockfile.
Install all five top-level tools because installing an internal dependency inside
another tool's environment does not independently expose that dependency's CLI.

For checksum-verified setup, download the wheels and checksum manifest first,
verify them, and pass the verified local wheel paths to the same command instead
of URLs. This changes only the input location, not dependency resolution. Internal
Battuta URL references must still resolve to the selected release assets.

Release installation still needs GitHub and the configured Python package index.
Pins are not a wheelhouse, dependency hash lock, or offline-install guarantee.

## Bot archive and installation

Extract the archive directly into an operator-selected absolute `<install-path>`.
Do not require a version number or a particular HOME-relative location in that path.

```text
<install-path>/
  bots/
    release.json
    _shared/
      <shared-runtime>/
        dist/                    # Compiled shared extension/runtime modules
        <runtime-resources>
        package.json
        pnpm-lock.yaml
    cos-bot/
      AGENTS.md
      package.json
      pnpm-lock.yaml
      .pi/
        settings.json
        extensions/              # Compiled role-specific extensions
        skills/
          <selected-skill>/      # Complete skill with its owned resources
    manager-bot/
      AGENTS.md
      package.json
      pnpm-lock.yaml
      .pi/
        settings.json
        extensions/
        skills/
    worker/
      AGENTS.md
      package.json
      pnpm-lock.yaml
      .pi/
        settings.json
        extensions/              # Includes compiled assignment-worker runtime
        skills/
```

`_shared/` owns shared runtime modules such as agent-mail, project-spec, and the
memory client; it is not a bot instance. Preserve existing dependency-installation
boundaries where practical. Shared code may be bundled into extension output when
that removes unnecessary runtime packages. Any remaining runtime package has a
production manifest and frozen lockfile in its owning installation directory.

Build output must not depend on the checkout, build-directory absolute paths,
TypeScript runtime entry points, or sibling packages omitted from the archive.
Include non-code runtime resources and dynamically loaded modules. Do not ship
source maps containing original TypeScript source content. Retain required licenses
and third-party notices.

The source repository retains `skills-hub/` and role selection manifests for
authoring and build-time selection. Packaging copies complete selected skill
directories into each role's `.pi/skills/`; shared selections may be duplicated
between roles. All worker instances use the one installed worker skill bundle.
Executable scripts owned by skills remain part of their skill resources; the
compiled-output requirement concerns Battuta extension/runtime TypeScript.

The archive excludes `node_modules/`, `.pi/npm/` package installations, credentials,
private settings, sessions, databases, tests, and development tooling. Installation
creates the required dependency directories within `<install-path>`.

## Persistent paths and ownership

```text
~/.battuta/
  .env.prod
  pi-bots/
    cos-bot/.pi/
    manager-bot/.pi/
    worker-1/.pi/
    worker-2/.pi/
```

There is no `workers/` parent directory and no production private bot state under
the installation. Each worker has an explicit instance identity independent of its
shared role profile. Never copy authentication or sessions between instances.

| Content                                                | Destination                                | Ownership                                                  |
| ------------------------------------------------------ | ------------------------------------------ | ---------------------------------------------------------- |
| Generated instructions, skills, compiled code          | `<install-path>/bots/`                     | Build-owned; replace as a whole                            |
| JavaScript dependencies and Pi packages                | Within `<install-path>/bots/`              | Installation-owned; reproducible from locked/pinned inputs |
| Environment and credentials                            | `~/.battuta/.env.prod`                     | Operator-owned; preserve                                   |
| `settings.json`, `auth.json`, `models.json`            | Each private `.pi/`                        | Pi/operator-owned; setup does not rewrite existing files   |
| MCP, Telegram, and applicable web-search configuration | Each private `.pi/`                        | Setup-owned; regenerate complete files                     |
| Sessions, mail sessions, OAuth state, caches           | Each private `.pi/`                        | Runtime-owned; preserve                                    |
| Memory, artifact, scheduler, and project data          | Existing owning service's persistent paths | Application-owned; outside installation                    |
| Python tool environments and commands                  | uv-managed locations                       | Installer-owned; reinstall exact release wheels            |
| User service units                                     | User systemd configuration directory       | Setup-owned; explicit replacement only                     |

Discover uv environment and executable locations using uv, not hardcoded HOME
paths. Create private credential/configuration files with restrictive permissions.
Never include credential values in generated service command lines, logs, or errors.
Prefer supported environment-variable credential references in generated files.
Only CoS receives Telegram configuration and credentials; preserve existing role
credential restrictions in launch environments.

## Native Pi runtime separation

| Instance | Working directory                 | `PI_CODING_AGENT_DIR`                |
| -------- | --------------------------------- | ------------------------------------ |
| CoS      | `<install-path>/bots/cos-bot`     | `~/.battuta/pi-bots/cos-bot/.pi`     |
| Manager  | `<install-path>/bots/manager-bot` | `~/.battuta/pi-bots/manager-bot/.pi` |
| Worker 1 | `<install-path>/bots/worker`      | `~/.battuta/pi-bots/worker-1/.pi`    |
| Worker 2 | `<install-path>/bots/worker`      | `~/.battuta/pi-bots/worker-2/.pi`    |

Pi 1.3.0 supports independent working and agent directories. It discovers project
instructions and `.pi/skills/` from the working directory, and authentication,
model registries, and private settings from the agent directory. Project settings
override private settings. Model selection writes to private settings.

Installed project settings own runtime configuration, but must not set personal
model/provider defaults. Fresh setup need not create private settings before Pi
does. Setup must reject private resource configuration that conflicts with the
release-owned runtime rather than merge or silently execute stale custom code.
Account for ancestor instruction discovery and Pi project trust during validation;
unexpected instruction overrides require operator resolution.

All mutable extension state must use an explicit instance-private or owning
application-data path. Two workers sharing the installed working directory must
not share sessions, claims, caches, or instance identity accidentally. Installed
instructions, skills, and extensions must not be modified during bot execution.

## Target prerequisites

- Oracle Linux 9 on AArch64, running as the ordinary bot user.
- nvm and uv already installed and usable by the ordinary bot user. Installing
  or configuring those tools is outside this release procedure.
- Node matching the repository `.node-version` (currently `24.21.0`), selected
  through nvm, and the package-manager version declared by the release. If the
  required Node version is absent, install it through the existing nvm setup.
- Python 3.12 available through uv's managed-Python support, plus required
  shell/download/checksum utilities. Do not require a separate system Python
  installation or replace Oracle Linux's system Python.
- Working systemd user services and the terminal utility required by Pi services.
- tmux for local bot panes and explicitly requested production foreground
  maintenance; it is not the production service supervisor.
- Registry access for locked JavaScript dependencies and metadata-pinned Python
  dependencies, plus GitHub Release access.
- Separately provisioned remote Supabase migrations and Edge Functions.

The guide must provide Oracle Linux-appropriate installation guidance using the
existing nvm and uv setup, and fail early if they are unavailable or cannot supply
the declared toolchain or required dependency wheels. Installing Node on the host
does not install Pi or extension dependencies.

nvm is shell initialization, not a service executable. Setup explicitly loads it
to select the required Node version, then resolves the absolute Node executable
and its directory. Launchers and generated units use that executable and an
explicit PATH for Node, uv, and uv-installed commands. Services must not depend
on shell startup files, `nvm use`, or whichever Node happens to be the user's
interactive default. Changing that default must not change a configured service's
Node version.

## Worker count and operator visibility

### Environment contract

Add this documented setting to `.env.example` and the environment contract used
to create `.env` and `~/.battuta/.env.prod`:

```dotenv
# Number of worker instances. Local development normally uses one; 0 disables workers.
WORKER_BOT_COUNT=1
```

The selected environment file is the source of truth. Require a non-negative
decimal integer; missing, empty, negative, fractional, or nonnumeric values fail
before worker provisioning or launch. Do not silently substitute a worker count.
Setup must not rewrite the operator's existing private environment files.

For count N, configure exactly `worker-1` through `worker-N` under the flat
`~/.battuta/pi-bots/` directory. For zero, configure/start no workers. CoS and
Manager are unaffected. Use one shared installed worker role bundle and one
separate private state directory per instance. Each worker runs as one process;
the count is an orchestration input, not permission for a worker to spawn peers.

Production service installation supplies `battuta-worker@.service` and selects
instances `battuta-worker@1.service` through `battuta-worker@N.service`. Setup
prepares configuration and units; the separate operator-approved activation step
starts/enables the selected instances. Memory, artifacts, CoS, and Manager retain
their separately named services. Do not retain a hardcoded singleton worker unit
as part of the new release contract.

This spec does not implement live autoscaling or reconcile a running deployment
after a count change. Report conflicting already-running instances for human
resolution; do not stop them, delete their state, or interrupt assignments just
because a smaller count was supplied.

### Local tmux

Source-checkout launch reads `WORKER_BOT_COUNT` from its selected `.env` file.
The normal local value is 1: show CoS, Manager, and worker-1 in separate tmux panes.
One bot process occupies one pane. If explicitly configured with multiple workers,
create one pane per selected worker; zero creates none. Label worker panes with
their instance identity. Preserve the current local backend-readiness check and
service panes; do not launch a second instance when reattaching an existing session.

Use the flat private worker paths locally as well. This is the specific local
launcher change required by the count/visibility feature; it does not require
moving source-checkout CoS/Manager private state as an unrelated change.

### Production logs

Production normally runs under systemd, not tmux. Document read-only per-worker
log viewing separately from interactive maintenance:

```sh
journalctl --user -u battuta-worker@2.service -f
```

The operator must name the intended instance. Journal output shows service output;
it is not an attachable Pi UI or a guarantee of a complete conversation transcript.
Do not introduce a second transcript store just to support log viewing.

### Foreground Pi UI maintenance

Opening a production Pi UI is an explicit maintenance action, not a live attach.
Require the operator to specify both foreground-maintenance intent and the bot
instance, for example: “Open worker-2 in foreground maintenance.” An unspecified
request must be clarified; do not choose worker-1, all workers, or a busy bot by
default. This applies to CoS and Manager maintenance too.

The documented sequence is:

1. Identify the exact instance and its service. If a worker is busy, require owner
   approval to interrupt its assignment; stopping Pi does not release its claim.
2. Stop that instance's service and verify its process has exited. Do not merely
   assume a failed stop command succeeded. Refuse foreground launch while the
   same instance is still running in systemd, tmux, or another foreground terminal.
3. Launch that bot in one dedicated tmux pane, using the same installed role,
   private environment, instance identity, and private state paths as its service.
   For worker-2 this means the installed `bots/worker` working directory and
   `~/.battuta/pi-bots/worker-2/.pi` agent directory. Maintain the existing worker
   conversation/assignment behavior; do not invent automatic assignment recovery.
4. Let the human use Pi directly. This is a real worker and may claim work; it is
   not an authentication-only or read-only inspection process. Do not send model
   prompts or manufacture assignments as an agent-run setup check.
5. Exit Pi and verify the foreground process has ended before explicitly returning
   the instance to service. Never run the service and maintenance process together.

Documentation provides copyable example commands/scripts for the chosen instance:
the `systemctl --user stop` and status checks, tmux pane launch through the normal
installed bot launcher, and the separate `systemctl --user start` action after
Pi exits. Reuse the owning launcher's environment/identity handling rather than
duplicate it in an example script. Reject attempts to reuse an occupied bot pane.
One bot is one pane; tmux detach leaves that maintenance process running and must
not be interpreted as Pi exit or permission to restart the service.

Do not configure automatic pane respawn or automatic service restart on maintenance
exit/failure. If stopping, launching, or exiting fails, leave the service stopped
where possible and report the state for a human decision. No production tmux
session is required unless the operator explicitly requests foreground maintenance.

## Fresh installation flow

1. Verify OS, architecture, existing nvm/uv setup, service-manager prerequisites,
   and target paths. Select/provision the release-declared toolchain through
   nvm and uv; do not install either tool or modify shell initialization. Require
   an empty installation destination; reject symlinks or unsafe
   path types. Setup does not automatically clear a nonempty directory.
2. Download release assets and verify checksums before extraction or installation.
   Validate that archive paths stay within the intended destination.
3. Extract `bots/`. Install production JavaScript dependencies with frozen
   lockfiles, and additional Pi packages at exact release-declared versions.
   Direct all package installations into the installation tree, not private bot
   homes. No dependency installation occurs on ordinary bot startup.
4. Install the five verified self-describing Python wheels through uv. Their
   metadata supplies all runtime pins and same-release internal wheel references;
   no separate constraints or additional `--with` arguments are required.
5. Have the operator create `~/.battuta/.env.prod` privately. Provide its required
   variable contract through installed setup tooling without adding another
   credential-template directory to the bot archive.
6. Read and validate `WORKER_BOT_COUNT`, selecting worker-1 through worker-N in
   addition to CoS and Manager. Create separate private homes
   and generate their MCP, CoS Telegram, and applicable web-search configuration.
   Validate all inputs before writing configuration; replace generated files
   atomically rather than merge them. Do not copy or initialize auth/model state
   from another profile or instance.
7. Provision memory and artifact application data through the installed Python
   commands, including required model assets and supported schema provisioning.
   Setup must fail if provisioning prerequisites are unavailable.
8. Install user service definitions for CoS, Manager, memory, artifacts, and the
   numbered worker instances selected by `WORKER_BOT_COUNT`. Do not hardcode one
   production worker instance.
   Units use the selected install path, discovered executable paths, private
   environment source, and explicit instance state paths.
9. Run configuration/filesystem validation. Installing or validating services
   must not start or enable bots. Starting services is a separate operator-approved
   action; workers may immediately claim queued work.

Keep installed launch and setup orchestration in the existing Python tooling
packages. Move needed archive shell-launcher behavior there instead of retaining
a second executable tooling tree outside `bots/`. Preserve required terminal,
session, role-isolation, scheduler, and service behavior.

## Replacement invariant, not migration

Everything below `<install-path>` is disposable and reproducible from one release
and its dependency inputs. With affected services stopped and explicit operator
approval, that directory can be cleared and installed afresh without moving private
state. This invariant is required; an upgrade/migration workflow is not in scope.

Repeated configuration regenerates setup-owned files completely and leaves private
Pi/operator files unchanged. Unexpected conflicts, malformed inputs, or incompatible
state stop setup; there are no automatic repairs, historical-key translations,
fallback searches, or cross-release merges. Errors identify affected paths and the
failed requirement without revealing private contents. Leave services stopped
after a failed installation; do not attempt automatic rollback or recovery.

## Build and release workflow

Use the existing ARM64 GitHub-hosted runner with an Oracle Linux 9 ARM64 container
for release assembly and target compatibility checks. Pin the verified container
image by digest and use the declared toolchain. The Ubuntu runner host is not the
build userspace. Assert Oracle Linux major version and AArch64 within the container.

Generate instructions, resolve skill selections, compile runtime modules, and
create production dependency inputs before assembling the archive. Keep existing
release provenance checks and required CI validation before publishing assets.

In a separate clean Oracle Linux 9 ARM64 environment, install the actual assembled
archive and wheels using the documented dependency process. Verify JavaScript
entry points/resources and Python imports/CLI help without connecting to external
production services or invoking models. Check native dependencies, not only the
architecture-independent JavaScript and pure-Python wheel labels.

Test Python installation without constraint files, source checkouts, or `--with`.
Before public release publication, expose the assembled internal wheel assets at
the actual release URLs (for example through a prerelease accessible to the test)
so the final wheel metadata can be tested unchanged. Promote the tested assets;
do not rebuild wheels with different metadata after the clean installation check.
Compare each installed environment's applicable runtime package versions with the
lock-derived release requirements, and verify all five CLI entry points. Do not
let preinstalled sibling tools or caches hide missing declared dependencies.

The container shares its host kernel; systemd user behavior, SELinux, and OCI host
configuration require separate machine acceptance. Do not claim that container
checks prove those properties or provider authentication.

## Documentation changes

- Keep `README.md` concise; replace Raspberry Pi terminology with the OCI/Oracle
  Linux ARM64 release target and link to the fresh-install guide.
- Rewrite `RELEASE.md` around these assets, paths, ownership, prerequisites, and
  fresh installation. Remove previous-deployment copying and migration procedures.
- Update the release workflow name and affected owning setup/technical references,
  including worker paths, compiled runtime locations, and service commands.
- Update `.env.example` and both local/production environment guidance with
  `WORKER_BOT_COUNT`. Document local one-bot-per-pane behavior, numbered worker
  journal commands, and explicit per-bot foreground-maintenance examples. Keep
  logs and interactive UI instructions distinct, including interruption approval
  and the separate return-to-service action.
- Preserve `RELEASE.md` as the extension/skill installation index. Source-checkout
  development remains separately documented; do not force production private
  state conventions onto development without a separate requirement.

## Acceptance criteria and verification

- A clean Oracle Linux 9 ARM64 environment with nvm and uv already configured
  installs the published artifacts without a source checkout, bundled Node,
  bundled dependency environments, or runtime hub. Noninteractive service commands
  resolve the selected Node version without loading nvm or shell startup files.
- Every role has build-generated instructions and exactly its selected complete
  skills; compiled entry points resolve after moving the archive to another valid
  installation path. No extension executes original TypeScript source.
- JavaScript dependency installation is locked/pinned, stays in the installation,
  and is not repeated at bot startup. Python dependencies stay in uv-managed tool
  environments, and Python tools match the bot release metadata.
- Every Python tool installs with `uv tool install --managed-python --python 3.12
<wheel-url-or-verified-local-path>` alone. Final wheel metadata contains all
  applicable runtime pins and correct same-release internal wheel URLs. Clean
  installation verifies the resolved versions without separate constraints,
  `--with`, or developer source paths. No constraint files are published.
- CoS and Manager use separate persistent agent directories. Two worker instances
  share installed code but retain independent identity and private runtime paths.
- Counts 0, 1, and multiple workers select exactly the expected instances and
  units; invalid/missing counts fail without launching workers. Local launch uses
  one pane per selected bot and does not duplicate processes on session reattach.
- Production log viewing identifies one numbered service without starting Pi.
  Foreground maintenance requires an explicit bot selection, refuses concurrent
  use of that identity, and does not automatically restart a service on detach,
  exit, or failure. Exercise orchestration with stubbed process/service boundaries;
  leave actual Pi UI interaction to the human.
- Setup preserves existing private settings, auth, model registries, and sessions
  byte-for-byte; changing generated inputs replaces owned configuration without
  keeping obsolete owned values. Test current-state behavior, not old layouts.
- Invalid input, unsafe paths, dependency failures, and conflicting configuration
  stop setup with sanitized errors and without starting bots or exposing secrets.
- Relevant unit tests cover changed executable behavior and package contracts.
  Reuse the existing support-test projects; do not test instruction wording or
  introduce elaborate new setup fixtures. Add one focused artifact-installation
  integration check rather than duplicate bot/model functional tests.
- Agent-run checks are filesystem/CLI checks with explicit expected results. Human
  acceptance owns authentication, model selection, Telegram replies, worker work,
  and actual OCI service operation. Setup completion is not functional acceptance.

## Out of scope

Migration, old-layout support, automatic cleanup or rollback, database restoration,
self-hosted CI runners, deployment containers on OCI, bundled Node/dependencies,
installing nvm or uv, and unrelated runtime feature changes.
