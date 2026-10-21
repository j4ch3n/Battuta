#!/usr/bin/env bash
# Install the service and explicitly apply Alembic migrations; never start it.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
component="$root/artifact-service"
python="$component/.venv/bin/python"
cli="$component/.venv/bin/battuta-artifact"

if [[ $# -gt 0 ]]; then
  if [[ $# == 1 && ( "$1" == --help || "$1" == -h ) ]]; then
    printf 'Usage: bash scripts/setup-artifacts.sh\nInstalls dependencies and applies registry migrations, without starting the server.\n'
    exit 0
  fi
  printf 'Unknown arguments. Usage: bash scripts/setup-artifacts.sh\n' >&2
  exit 2
fi
command -v uv >/dev/null || { printf 'uv is required for artifact setup.\n' >&2; exit 1; }
umask 077

if [[ -d "$component/wheels" ]]; then
  [[ -s "$component/wheels/SHA256SUMS" ]] || { printf 'Missing artifact wheel checksums.\n' >&2; exit 1; }
  if [[ ! -x "$python" ]]; then uv venv --python 3.12 "$component/.venv"; fi
  "$python" - "$component/wheels" <<'PY'
import hashlib
import sys
from pathlib import Path
root = Path(sys.argv[1])
for line in (root / "SHA256SUMS").read_text().splitlines():
    expected, name = line.split()
    if Path(name).name != name or not name.endswith(".whl"):
        raise SystemExit("Invalid artifact wheel checksum entry")
    with (root / name).open("rb") as wheel:
        if hashlib.file_digest(wheel, "sha256").hexdigest() != expected:
            raise SystemExit(f"Artifact wheel checksum mismatch: {name}")
PY
  uv pip install --python "$python" --offline --no-index --find-links "$component/wheels" \
    --require-hashes --only-binary :all: -r "$component/requirements.txt"
  shopt -s nullglob
  own=("$component"/wheels/battuta_artifacts-*.whl)
  [[ ${#own[@]} == 1 ]] || { printf 'Expected one Battuta artifact wheel.\n' >&2; exit 1; }
  uv pip install --python "$python" --offline --no-index --no-deps "${own[0]}"
else
  uv sync --project "$component" --locked --no-dev --python 3.12
fi

"$cli" setup
printf 'Artifact setup complete. Start the server separately.\n'
