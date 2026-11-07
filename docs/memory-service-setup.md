# Memory service installation

Use the same login user and HOME for setup, the server, and the bots. The server runs locally without a dashboard or an LLM credential.

## Raspberry Pi baseline

Use 64-bit Raspberry Pi OS Bookworm or newer: `uname -m` must report `aarch64`, `getconf LONG_BIT` must report `64`, and glibc must be at least 2.28. Pi 4/5 with 4 GB RAM is the initial validation target, not a measured minimum. Install uv and provide compatible CPython 3.12; the installer selects managed Python rather than changing system Python. Native wheel loading may require the operator to install Debian packages `libgomp1` and `libstdc++6`. There is no armv7, PyTorch, GPU or on-device compilation path.

## Provision

Source checkout:

```sh
bash scripts/setup-memory.sh
```

For a release, first install the separate `battuta-memory` wheel with
`uv tool install --managed-python --python 3.12`, using the selected GitHub
Release's checksum and dependency constraints from release setup. Then provision:

```sh
bin/battuta setup-memory
```

Release setup uses the uv-managed tool environment already installed by the bot
user; it does not install from a bundled wheelhouse or CLI source directory.
Source setup resolves only locked dependencies. Setup checks actual sqlite-vec
extension loading and ONNX Runtime CPU availability; it never falls back to
pseudo-embeddings or installs with sudo.

Release `bin/battuta setup-memory` and `bin/battuta memory` load `.env.prod` when present, matching the bot commands' data-directory settings. Direct source setup uses the calling shell's environment; export any custom `BATTUTA_MEMORY_DATA_DIR` before provisioning.

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

CoS loads the memory client, but its main session does not select the memory skill or connect to memory MCP. Its isolated recall agent exposes only direct recall/get tools using explicit loopback configuration. Manager and workers receive selected Agent Mail context instead. See [skill management](skill-management.md) for manifest ownership and validation.

Source `--bot-dir` workspaces use their own manifest or the owning role's selection. Custom skill content and private queues/profiles remain preserved. CoS capture defaults on; non-CoS roles do not load the adapter. CoS's main MCP configuration has a disabled memory override to prevent inherited user-level exposure; managed Manager/worker entries remain absent. Unrelated servers/auth remain unchanged. This is configuration separation, not a same-user security sandbox. Setup does not edit private profiles, start bots, or invoke models. Recall needs no origin-producer integration and never restricts by selected project. Unknown write scope is omitted/deferred, not invented as global.

## Services

`bin/battuta install-services` writes five user units (CoS, Manager, Worker, memory, and artifacts) without enabling/restarting them. It refuses conflicting existing units before writing anything unless the operator explicitly uses `--replace` after stopping the old deployment; symlinked units are always refused. Check custom unit edits and drop-ins before replacement. Then enable `battuta-memory.service` with `systemctl --user`. All three bots want the memory unit but do not require it: memory failure must not kill conversations. Use `journalctl --user -u battuta-memory` for diagnostics. Only one server owns the shared data directory; occupied ports are errors, not permission to connect to an unknown backend.

Default endpoint: `http://127.0.0.1:8901/mcp`. Default data: `~/.battuta/memory/`. CoS and the service use the same `BATTUTA_MEMORY_URL`. Remote binding/authentication is deliberately unsupported. Source tmux launching adds one memory window; do not run it alongside a systemd server on the same data/port.

## Nightly CoS dream setup

Dream automatically changes server memories and refreshes revision-cited profile claims. It preserves untracked `ME.md`. Configure it only after owner approval of unattended consolidation; ordinary bot configuration does not imply this approval.

**Installing the scheduler does not create the dream schedule.** Neither normal bot configuration nor memory-service setup runs the command below. Normal CoS configuration initializes an empty native store at `~/.battuta/schedule-prompts.json`; dream is not active until explicitly provisioned.

An approved dream enforces cleanup, synthesis and challenge before guarded publication, then refreshes eligible profile claims and the private reflection. It no longer requires global clustering/relationship generation. Upgrade server and client together; existing graph data, checkpoints and mutation receipts remain preserved. No additional scheduler, model download or login is introduced.

1. Stop CoS before editing scheduler files. Confirm the memory service is ready, CoS's scheduler is `@jl1990/pi-scheduler@0.5.1`, and normal CoS configuration has initialized the stable store. Load the same selected environment as CoS, including any `PI_SCHEDULER_STATE_FILE` and `BATTUTA_MEMORY_DATA_DIR` overrides. In CoS `.pi/settings.json`, select explicit `defaultProvider` and `defaultModel` IDs for the intended dream model; ensure it is authenticated and available in CoS's model registry.
2. Confirm which timezone should define **03:00**. The scheduler and catch-up use process-local time; configure CoS's launch environment `TZ` consistently when a specific zone is required. There is no separately configured dream timezone or OS wake-up timer.
3. Back up shared memory data and private client state. The tracked view is `<BATTUTA_MEMORY_DATA_DIR>/dream-profile.json`; shared `ME.md` is preserved and injected separately into main CoS as untrusted owner-profile context. Old bot `.pi/ME.md` is not a fallback or automatically imported. Neither file is independently verified evidence merely because it exists.
4. From the installation root, provision the owned global task and dedicated extension:

   ```sh
   node memory-client/configure-dream.mjs bots/cos-bot
   ```

   In a release archive use `bin/node` in place of `node`. This command requires a valid initialized stable store, writes the owned task there, creates `<BATTUTA_MEMORY_DATA_DIR>/dream-config.json` (default `~/.battuta/memory/dream-config.json`), and registers `memory-client/dream-extension.ts` in CoS's `.pi/settings.json`. For a custom CoS workspace, replace `bots/cos-bot` with its directory. It edits configuration only; do not run it against live CoS.

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
