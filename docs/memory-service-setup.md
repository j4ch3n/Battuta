# Memory service installation

Use the same login user and HOME for setup, the server, and the bots. The server
itself needs no LLM credential. The nightly dream runs Claude Code (`claude`) as
that user, so Claude Code must be installed and signed in.

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
Release's checksums. Its wheel metadata supplies pinned runtime dependencies,
including the agent-memory library pinned to one commit. Load the same private
environment used by services, then provision:

```sh
battuta-memory model install
battuta-memory model verify --json
battuta-memory doctor --json
```

Model setup downloads the pinned Qwen3-Embedding-0.6B int8 ONNX model (about
614 MB) and its tokenizer from Hugging Face at a fixed revision, verifies each
file's SHA256, and installs them under
`~/.cache/battuta/models/qwen3-embedding-0.6b-int8/`. The cache follows HOME, not
the data directory. A verified cache is reused offline; the server never downloads
at runtime. To install without network access to Hugging Face, copy
`onnx/model_int8.onnx` and `tokenizer.json` from
`onnx-community/Qwen3-Embedding-0.6B-ONNX` into one directory and run
`battuta-memory model install --from-dir DIR` (source setup:
`bash scripts/setup-memory.sh --from-dir DIR`).

Check the setup:

```sh
battuta-memory model verify --json
battuta-memory doctor --json
command -v claude
command -v battuta-project
```

Each must exit zero. `doctor` prints `"ready": true` with the store path and its
memory count. Stop if any check fails. For a source checkout, use
`memory-service/.venv/bin/battuta-memory`; do not mix source and release
environments.

## Bot exposure

- **CoS** loads the memory client extension: owner card, pre-reply recall, the
  `memory_recall` and `memory_types` tools, and `memory_dream`. Its MCP
  configuration disables the memory server, so the model cannot call write or
  dream tools directly.
- **Manager** selects the `project-memory` skill and connects to the read-only
  endpoint `<BATTUTA_MEMORY_URL>/read`.
- **Workers** get no memory connection; context arrives through assignments.

CoS and the service read the project catalog with `battuta-project list --json`,
which needs the CLI on `PATH` and `LINEAR_API_TOKEN` in the environment (listing
does not contact Linear).

## Services

`battuta-packaging install-services --root DIR --env-file FILE --node PATH`
writes the memory unit with the other units, without enabling or restarting
anything. Bots want the memory unit but do not require it: memory failure must
not stop conversations. Use `journalctl --user -u battuta-memory` for diagnostics.
Only one server owns the data directory.

Defaults: endpoint `http://127.0.0.1:8901/mcp`, data `~/.battuta/memory/`.
`BATTUTA_MEMORY_DATA_DIR`, `BATTUTA_MEMORY_HOST`, `BATTUTA_MEMORY_PORT`, and
`BATTUTA_MEMORY_DREAM_MODEL` (Claude Code model, default `claude-haiku-5-5`)
override them. Remote binding is unsupported.

## Nightly dream setup

CoS configuration (source or release) provisions the owned nightly task at
**05:30** process-local time in the stable scheduler store. Configure CoS's `TZ`
when a specific zone is required. The task asks CoS to call `memory_dream`. A
missed run may execute when CoS next starts.

1. Stop CoS before configuration, and use the same environment as CoS,
   including any `PI_SCHEDULER_STATE_FILE` override.
2. Run normal CoS configuration, or `configure-release` for a release. It
   preserves unrelated tasks and the owned task's disabled state; conflicting
   owned tasks fail without changing the store.
3. Check without starting CoS:

   ```sh
   test -s "${PI_SCHEDULER_STATE_FILE:-$HOME/.battuta/schedule-prompts.json}"
   ```

   It must exit zero.

To pause dreams, stop CoS, set the owned job's `enabled` to `false`, then restart.
See [memory operations](memory-service.md) for the dream steps and recovery.
