# Memory service installation

Use the same login user and HOME for setup, the server, and the bots. The server runs locally without a dashboard or an LLM credential.

## OCI ARM64 baseline

The release target is Oracle Linux 9 on OCI Ampere A1: `uname -m` must report
`aarch64`, `getconf LONG_BIT` must report `64`, and glibc must be at least 2.28.
Use the existing uv installation for managed CPython 3.12, without changing system
Python. Oracle Linux native dependencies include `libgomp` and `libstdc++`.
There is no armv7, PyTorch, GPU, or on-device compilation path.

## Provision

Source checkout:

```sh
bash scripts/setup-memory.sh
```

For a release, first install the separate `battuta-memory` wheel with
`uv tool install --managed-python --python 3.12`, using the selected GitHub
Release's checksums. Its wheel metadata supplies pinned runtime dependencies.
Load the same private environment/overrides used by services, then provision:

```sh
battuta-memory model install
battuta-memory model verify --json
battuta-memory doctor --json
```

Release setup uses the uv-managed tool environment already installed by the bot
user; it does not install from a bundled wheelhouse or CLI source directory.
Source setup resolves only locked dependencies. Setup checks actual sqlite-vec
extension loading and ONNX Runtime CPU availability; it never falls back to
pseudo-embeddings or installs with sudo.

Installed services load `~/.battuta/.env.prod` through the packaging launcher.
Direct provisioning and source setup use the calling shell's environment; load
the same trusted private file without shell tracing and export any custom
`BATTUTA_MEMORY_DATA_DIR` before provisioning. Direct server startup is
`battuta-memory serve`.

Model setup downloads the approximately 80 MB pinned MiniLM ONNX archive, verifies its SHA256, and atomically installs weights/tokenizer under `~/.cache/mcp_memory/onnx_models/all-MiniLM-L6-v2/onnx/`. This cache follows HOME, not the database setting. An unknown existing cache is not overwritten: move it aside yourself if you want to replace it. A verified cache is reused offline. Runtime downloads are disabled.

For model provisioning without downloading the model, copy the archive from `https://chroma-onnx-models.s3.amazonaws.com/all-MiniLM-L6-v2/onnx.tar.gz` and run setup with `--archive /path/onnx.tar.gz`. Expected SHA256: `913d7300ceae3b2dbc2c50d1de4baacab4be7b9380491c27fab7418616a16ec3`. Python tool installation still requires network access to GitHub and PyPI; an offline dependency bundle is not provided.

```sh
export PATH="$(uv tool dir --bin):$PATH"
battuta-memory model verify --json
battuta-memory doctor --json
```

Run doctor before starting the server; it takes the same single-owner data lock. The running server exposes `memory_health` instead. A corrupt/missing model or changed model fingerprint fails readiness even on an empty database. A model change requires an explicit re-embedding migration, not merely equal dimensions.

For a source checkout, use `memory-service/.venv/bin/battuta-memory` instead of
the globally installed command above. Do not mix source and release environments.

## Bot skill exposure

CoS loads the memory client, but its main session does not select a memory skill or connect to memory MCP. Its isolated recall agent exposes only direct recall/get tools using explicit loopback configuration. Manager selects `project-memory` and connects directly to the shared memory MCP for project/global retrieval and supported deliberate maintenance. Workers receive selected Agent Mail context instead. See [skill management](skill-management.md) for manifest ownership and validation.

Source `--bot-dir` workspaces use their own manifest or the owning role's selection. Custom skill content and private queues/profiles remain preserved. CoS capture defaults on; non-CoS roles do not load the adapter. CoS and Worker main MCP configurations have disabled memory overrides to prevent inherited user-level exposure; Manager receives the native loopback memory connection. Unrelated servers/auth remain unchanged. This is configuration separation, not a same-user security sandbox. Setup does not edit private profiles, start bots, or invoke models. Recall needs no origin-producer integration and never restricts by selected project. Unknown write scope is omitted/deferred, not invented as global.

CoS's launch environment must provide the updated `battuta-project` command with
`list --json` support and its required `LINEAR_API_TOKEN` environment variable.
Discovery does not contact Linear. CoS and the CLI use the same fixed project root,
`~/.battuta/projects`, derived from their OS user's home directory. Remove old
project-root overrides and prepare existing configurations using the
[project configuration contract](project-context.md). The memory server does not
need the project command, token, or registry directory.
Upgrade the memory client and server together; the public API now uses `projects`
rather than `scope`, with explicit list selectors and all-scope recall by default. Existing storage and pending
delivery identities are preserved without re-embedding.

With CoS stopped, check the CLI contract without a bot/model call:

```sh
command -v battuta-project
battuta-project list --json
```

Stop if either command fails. Successful output is a JSON `projects` array, empty
when no projects are registered. Names retain registered spelling; any case variant
of `global` conflicts with the reserved memory label and must be resolved by the owner.

## Services

`battuta-packaging install-services --root DIR --env-file FILE --node PATH`
writes CoS/Manager, numbered-worker template, memory, and artifact units without
enabling/restarting anything. Conflicting files and symlinks fail preflight.
Replacement requires explicit approval and stopped affected services. Bots want
the memory unit but do not require it: memory failure must not kill conversations.
Use `journalctl --user -u battuta-memory` for diagnostics. Only one server owns the
data directory; occupied ports are errors, not permission to use an unknown backend.

Default endpoint: `http://127.0.0.1:8901/mcp`. Default data: `~/.battuta/memory/`. CoS and the service use the same `BATTUTA_MEMORY_URL`. Remote binding/authentication is deliberately unsupported. Source tmux launching adds one memory window; do not run it alongside a systemd server on the same data/port.

## Nightly CoS dream setup

Dream is a standard part of CoS in both local development and production. Setup must make the `memory_dream` tool available and enable its nightly schedule. Dream automatically changes server memories and refreshes revision-cited profile claims; it preserves untracked `ME.md`.

Source CoS configuration and release configuration provision the dream extension, model configuration and scheduler task automatically.

An approved dream enforces cleanup, synthesis and challenge before guarded publication, then refreshes eligible profile claims and the private reflection. It no longer requires global clustering/relationship generation. Upgrade server and client together; existing graph data, checkpoints and mutation receipts remain preserved. No additional scheduler, model download or login is introduced.

1. Stop CoS before running configuration. Select explicit `defaultProvider` and `defaultModel` IDs in CoS's private settings (`~/.battuta/pi-bots/cos-bot/.pi/settings.json`), and use the same environment as CoS, including any `PI_SCHEDULER_STATE_FILE` and `BATTUTA_MEMORY_DATA_DIR` overrides. Provider authentication/availability is human acceptance, not an agent-run check.
2. Confirm which timezone should define **05:30**. The scheduler and catch-up use process-local time; configure CoS's launch environment `TZ` consistently when a specific zone is required. There is no separately configured dream timezone or OS wake-up timer. An existing owned 03:00 task causes an ownership conflict and is not changed automatically; the owner must remove it manually with CoS stopped before rerunning setup.
3. Back up shared memory data and private client state. The tracked view is `<BATTUTA_MEMORY_DATA_DIR>/dream-profile.json`; shared `ME.md` is preserved and injected separately into main CoS as untrusted owner-profile context. Old bot `.pi/ME.md` is not a fallback or automatically imported. Neither file is independently verified evidence merely because it exists.
4. Run normal CoS configuration for a source checkout or `configure-release` for a release. It initializes the stable scheduler store, registers the CoS dream extension, and provisions the dream model and owned task without starting a bot.

   The command preserves unrelated settings/tasks, an existing model configuration and the task's disabled state. A new task is enabled; the next CoS startup may immediately catch up the latest missed run. It captures CoS defaults only when creating model configuration, never falling back to the conversation model later. To change the model, edit `dream-config.json` with CoS stopped: `{"version":1,"model":"provider/model-id"}`. Conflicting owned tasks or malformed configuration fail without replacing the schedule.

5. Verify the configuration without starting CoS or invoking a model:

   ```sh
   test -s "${PI_SCHEDULER_STATE_FILE:-$HOME/.battuta/schedule-prompts.json}"
   test -s "${BATTUTA_MEMORY_DATA_DIR:-$HOME/.battuta/memory}/dream-config.json"
   ```

   Both checks must exit zero. Stop if either file is missing or empty; do not
   start CoS to recover from incomplete setup. The configured task and model are
   intentionally not exercised during setup.

To pause future dreams, stop CoS and set the owned job's `enabled` to `false`, then restart. Capture has a separate `battutaMemoryCapture.enabled` toggle: disabling capture does not disable an approved dream schedule. See [memory operations](memory-service.md#owner-profile-and-nightly-dream) for recovery and privacy boundaries. No setup command restarts bots, changes provider login, or enables an OS service automatically.
