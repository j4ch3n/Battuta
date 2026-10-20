#!/usr/bin/env bash
# Provision memory under the bot login user; never launch bots or migrate old data.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
component="$root/memory-service"
python="$component/.venv/bin/python"
cli="$component/.venv/bin/battuta-memory"
archive=""

fail() { printf 'Memory setup: %s\n' "$*" >&2; exit 1; }
usage() { printf 'Usage: bash scripts/setup-memory.sh [--archive /path/onnx.tar.gz]\n'; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --archive)
      [[ $# -ge 2 && -f "$2" ]] || fail '--archive requires an existing model archive file.'
      archive="$2"
      shift 2
      ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; fail "Unknown argument: $1" ;;
  esac
done

run() {
  local stage="$1" remedy="$2"
  shift 2
  printf 'Memory setup: %s\n' "$stage"
  "$@" || fail "Failed during $stage. $remedy"
}

system="$(uname -s)"
machine="$(uname -m)"
case "$system/$machine" in
  Darwin/arm64|Darwin/x86_64) ;;
  Linux/aarch64)
    [[ "$(getconf LONG_BIT)" == 64 ]] || fail 'Use 64-bit Raspberry Pi OS Bookworm or newer, not a 32-bit userspace.'
    libc="$(getconf GNU_LIBC_VERSION 2>/dev/null)" || fail 'glibc >=2.28 is required; musl is unsupported.'
    read -r family version <<< "$libc"
    major="${version%%.*}"
    minor="${version#*.}"
    minor="${minor%%.*}"
    [[ "$family" == glibc && "$major" =~ ^[0-9]+$ && "$minor" =~ ^[0-9]+$ ]] || fail "Unsupported libc: $libc"
    (( major > 2 || (major == 2 && minor >= 28) )) || fail 'Use glibc >=2.28 (64-bit Raspberry Pi OS Bookworm or newer).'
    ;;
  *) fail "Unsupported platform: $system/$machine. Use 64-bit Raspberry Pi OS (aarch64/glibc >=2.28), or an arm64/x86_64 macOS development host." ;;
esac
command -v uv >/dev/null || fail 'uv is required. Install uv, then rerun setup; do not use system pip or sudo.'

if [[ -d "$component/wheels" ]]; then
  # Verify the wrapper too; dependency installation additionally enforces requirement hashes.
  [[ -s "$component/wheels/SHA256SUMS" ]] || fail 'Missing wheel checksums. Re-download and verify the complete release archive.'
  if command -v sha256sum >/dev/null; then
    checksum=(sha256sum)
  elif command -v shasum >/dev/null; then
    checksum=(shasum -a 256)
  else
    fail 'sha256sum or shasum is required to verify release wheels.'
  fi
  while read -r expected name; do
    [[ "$expected" =~ ^[0-9a-f]{64}$ && "$name" == *.whl && "$name" != */* && -f "$component/wheels/$name" ]] || fail 'Invalid wheel manifest. Re-download the release; do not bypass checksum verification.'
    actual="$("${checksum[@]}" "$component/wheels/$name")" || fail "Cannot read wheel: $name"
    [[ "${actual%% *}" == "$expected" ]] || fail "Wheel checksum mismatch: $name. Re-download and verify the release archive."
  done < "$component/wheels/SHA256SUMS"
  if [[ ! -x "$python" ]]; then
    run 'Python environment creation' 'Make managed CPython 3.12 available through uv; offline hosts must provision Python first.' \
      uv venv --managed-python --python 3.12 "$component/.venv"
  fi
  run 'offline release dependency installation' 'Use the complete linux-arm64 release with CPython 3.12. Read the missing/incompatible wheel error above; no source build fallback is supported.' \
    uv pip install --python "$python" --offline --no-index --find-links "$component/wheels" --require-hashes --only-binary :all: -r "$component/requirements.txt"
  shopt -s nullglob
  own=("$component"/wheels/battuta_memory-*.whl)
  [[ ${#own[@]} -eq 1 ]] || fail 'Expected exactly one Battuta memory wheel. Re-download the complete release.'
  run 'Battuta memory wheel installation' 'Verify the release archive and Python 3.12 environment, then rerun setup.' \
    uv pip install --python "$python" --offline --no-index --no-deps "${own[0]}"
else
  run 'locked dependency installation' 'Check uv, network access, and compatible native wheels for managed CPython 3.12. Dependencies must not need source compilation.' \
    uv sync --project "$component" --locked --no-dev --no-install-project --no-build --managed-python --python 3.12
  run 'local Battuta package installation' 'Check the build error above; only this repository-owned package is built locally.' \
    uv pip install --python "$python" --no-deps --editable "$component"
fi

run 'native SQLite and ONNX loading' 'Use managed CPython 3.12 with SQLite extension loading. On Raspberry Pi OS, install libgomp1/libstdc++6 if the native loader reports missing libraries; read the error above.' \
  "$python" -c "import sqlite3, sqlite_vec, onnxruntime, tokenizers; c=sqlite3.connect(':memory:'); c.enable_load_extension(True); sqlite_vec.load(c); c.enable_load_extension(False); c.close(); assert 'CPUExecutionProvider' in onnxruntime.get_available_providers()"
model_args=(model install)
if [[ -n "$archive" ]]; then model_args+=(--archive "$archive"); fi
run 'verified model provisioning' 'Check HOME/cache ownership, disk space, and network access; use --archive for offline provisioning. Move an unverified existing cache aside explicitly rather than overwriting it.' \
  "$cli" "${model_args[@]}"
run 'backend readiness' 'Read the error above. Stop an existing server before doctor (use memory_health when running). Keep HOME/data paths consistent; never bypass fingerprint checks.' \
  "$cli" doctor --json
printf 'Memory setup complete. Start the shared server separately; no bots were restarted.\n'
