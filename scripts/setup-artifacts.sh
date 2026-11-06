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

if [[ -f "$component/pyproject.toml" ]]; then
  uv sync --project "$component" --locked --no-dev --python 3.12
else
  cli="$(command -v battuta-artifact)" || { printf 'Install battuta-artifacts with uv tool install as described in RELEASE.md\n' >&2; exit 1; }
fi

"$cli" setup
printf 'Artifact setup complete. Start the server separately.\n'
