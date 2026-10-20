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

## Services

`bin/battuta install-services` writes three user units without enabling/restarting them. It refuses conflicting existing units before writing anything; move customized old units aside explicitly. Then enable `battuta-memory.service` with `systemctl --user`. PM/TL want the memory unit but do not require it: memory failure must not kill Telegram conversations. Use `journalctl --user -u battuta-memory` for diagnostics. Only one server owns the shared data directory; occupied ports are errors, not permission to connect to an unknown backend.

Default endpoint: `http://127.0.0.1:8901/mcp`. Default data: `~/.battuta/memory-service/`. Bots must use the same `BATTUTA_MEMORY_URL`. Remote binding/authentication is deliberately unsupported. Source tmux launching adds one memory window; do not run it alongside a systemd server on the same data/port.

## Hardware acceptance

On the physical Pi, record model/RAM/OS/Python/ONNX versions, cold readiness time, warm store/recall latency and peak RSS with both bots connected. Restart with networking unavailable and confirm semantic recall still works. Test model corruption only in a disposable HOME: readiness must fail without accepting writes. Verify a second server is refused, and a bot can keep answering while memory is unavailable, then upload its queued capture after recovery. macOS checks do not establish Raspberry Pi performance or hardware acceptance.
