# Memory service installation

Use the same login user and HOME for setup, the server, and the bots. The server runs locally without a dashboard or an LLM credential.

## Raspberry Pi baseline

Use 64-bit Raspberry Pi OS Bookworm or newer: `uname -m` must report `aarch64`, `getconf LONG_BIT` must report `64`, and glibc must be at least 2.28. Pi 4/5 with 4 GB RAM is the initial validation target, not a measured minimum. Install uv and provide compatible CPython 3.12; the installer selects managed Python rather than changing system Python. Native wheel loading may require the operator to install Debian packages `libgomp1` and `libstdc++6`. There is no armv7, PyTorch, GPU or on-device compilation path.

## Provision

Source checkout:

```sh
bash scripts/setup-memory.sh
memory-service/.venv/bin/battuta-memory serve
```

Release archive:

```sh
bin/battuta setup-memory
bin/battuta memory
```

The release installs a hash-verified ARM64 wheelhouse into a target-created virtualenv. Source setup resolves only locked dependencies. Setup checks actual sqlite-vec extension loading and ONNX Runtime CPU availability; it never falls back to pseudo-embeddings or installs with sudo.

Release `bin/battuta setup-memory` and `bin/battuta memory` load `.env.prod` when present, matching the bot commands' data-directory settings. Direct source setup uses the calling shell's environment; export any custom `BATTUTA_MEMORY_DATA_DIR` before provisioning.

Model setup downloads the approximately 80 MB pinned MiniLM ONNX archive, verifies its SHA256, and atomically installs weights/tokenizer under `~/.cache/mcp_memory/onnx_models/all-MiniLM-L6-v2/onnx/`. This cache follows HOME, not the database setting. An unknown existing cache is not overwritten: move it aside yourself if you want to replace it. A verified cache is reused offline. Runtime downloads are disabled.

For disconnected provisioning, copy the archive from `https://chroma-onnx-models.s3.amazonaws.com/all-MiniLM-L6-v2/onnx.tar.gz` and run setup with `--archive /path/onnx.tar.gz`. Expected SHA256: `913d7300ceae3b2dbc2c50d1de4baacab4be7b9380491c27fab7418616a16ec3`. The release wheelhouse works offline; uv's managed Python must already be available if the Pi has no network.

```sh
memory-service/.venv/bin/battuta-memory model verify --json
memory-service/.venv/bin/battuta-memory doctor --json
```

Run doctor before starting the server; it takes the same single-owner data lock. The running server exposes `memory_health` instead. A corrupt/missing model or changed model fingerprint fails readiness even on an empty database. A model change requires an explicit re-embedding migration, not merely equal dimensions.

## Bot skill exposure

Source bot configuration (`bots/pm-bot/scripts/configure-bot.py` and `bots/tl-bot/scripts/configure-bot.py`) and release `bin/battuta configure` expose each role's skill at `.pi/skills/memory`: PM links to `shared-skills/memory`, TL to `shared-skills/memory-tl`. Source `--bot-dir` selects a custom workspace without changing the script's explicit role. Both skill frontmatters are named `memory`; do not install both into one bot. Project-context links are unchanged.

Setup migrates TL's known old `../../../../shared-skills/memory` link to the read-only source. It refuses unrelated custom links, files, or directories rather than replacing them; review and move a custom entry aside explicitly before retrying. PM capture defaults on and TL capture defaults off. The shared server may still expose write tools: TL's read-only boundary is role guidance, not server-side access control. Setup does not edit private profiles or start bots.

## Services

`bin/battuta install-services` writes three user units without enabling/restarting them. It refuses conflicting existing units before writing anything; move customized old units aside explicitly. Then enable `battuta-memory.service` with `systemctl --user`. PM/TL want the memory unit but do not require it: memory failure must not kill Telegram conversations. Use `journalctl --user -u battuta-memory` for diagnostics. Only one server owns the shared data directory; occupied ports are errors, not permission to connect to an unknown backend.

Default endpoint: `http://127.0.0.1:8901/mcp`. Default data: `~/.battuta/memory/`. Bots must use the same `BATTUTA_MEMORY_URL`. Remote binding/authentication is deliberately unsupported. Source tmux launching adds one memory window; do not run it alongside a systemd server on the same data/port.

## Hardware acceptance

On the physical Pi, record model/RAM/OS/Python/ONNX versions, cold readiness time, warm store/recall latency and peak RSS with both bots connected. Restart with networking unavailable and confirm semantic recall still works. Test model corruption only in a disposable HOME: readiness must fail without accepting writes. Verify a second server is refused, and a bot can keep answering while memory is unavailable, then upload its queued capture after recovery. macOS checks do not establish Raspberry Pi performance or hardware acceptance.

## Nightly PM dream setup

Dream automatically changes server memories and replaces the shared personal profile. Configure it only after the owner has approved unattended consolidation. Ordinary bot configuration does not imply this approval.

1. Stop PM before editing scheduler files. Confirm the memory service is ready, PM's scheduler is `pi-schedule-prompt@0.4.1`, and PM has authenticated model access. In PM `.pi/settings.json`, select explicit `defaultProvider` and `defaultModel` values for the intended dream model. These are provider/model IDs, not credentials.
2. Confirm which timezone should define **03:00**. The scheduler and catch-up use process-local time; configure PM's launch environment `TZ` consistently when a specific zone is required. There is no separately configured dream timezone or OS wake-up timer.
3. Back up the shared memory data and any existing profile. The new profile path is `<BATTUTA_MEMORY_DATA_DIR>/ME.md`, defaulting to `~/.battuta/memory/ME.md`. Old bot `.pi/ME.md` files are not imported. If the owner wants existing private understanding carried forward, arrange an explicit reviewed copy before activation; setup never overwrites it with a template.
4. From the installation root, provision the owned workdir job and dedicated extension:

   ```sh
   node memory-client/configure-dream.mjs bots/pm-bot
   ```

   In a release archive use `bin/node` in place of `node`. This command is operator-invoked, not a live scheduler edit. It preserves unrelated settings/jobs, an existing dream model and its disabled state, and uses the PM defaults for a new job. A new job is enabled; the next PM startup may immediately catch up the latest missed run.

5. Inspect PM `.pi/schedule-prompts.json`: exactly one owned `battuta-memory-dream` / `nightly-memory-dream` job, `schedule:"0 0 3 * * *"`, explicit `model`, `notify:false`, no `session` binding, and only the absolute dedicated dream extension path in `extensions`. Keep `skills:[]`. Do not broaden the child to all PM integrations.
6. Start a single PM process. Verify scheduler discovery, job scope, next due time and model. Startup catch-up resolves the owned job's exact provider/model independently of the conversation's selected model. The scheduled child uses persisted agent-directory model/auth configuration, not providers or credentials registered only in the parent session's memory. Verify the dedicated tool first with disposable data and a separate memory-service endpoint; never point a test at production memory accidentally. Check that a completed run publishes canonical `ME.md` and exactly one under-150-word reflection, and restart does not repeat the same run.

To pause future dreams, stop PM and set the owned job's `enabled` to `false`, then restart. Capture has a separate `battutaMemoryCapture.enabled` toggle: disabling capture does not disable an approved dream schedule. See [memory operations](memory-service.md#owner-profile-and-nightly-dream) for recovery and privacy boundaries. No setup command restarts bots, changes provider login, or enables an OS service automatically.
