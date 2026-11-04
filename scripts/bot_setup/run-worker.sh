#!/usr/bin/env bash
set -euo pipefail
umask 077
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
bot_dir=""
env_file="$root/.env"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --bot-dir|--env-file)
      [[ $# -ge 2 ]] || { printf 'Missing option value\n' >&2; exit 2; }
      if [[ "$1" == --bot-dir ]]; then bot_dir="$2"; else env_file="$2"; fi
      shift 2 ;;
    *) printf 'Usage: run-worker.sh --bot-dir DIRECTORY [--env-file FILE]\n' >&2; exit 2 ;;
  esac
done
[[ -n "$bot_dir" && -d "$bot_dir" && -f "$env_file" ]] || { printf 'Worker directory and environment file are required\n' >&2; exit 1; }
bot_dir="$(cd "$bot_dir" && pwd)"
for file in AGENTS.md .pi/settings.json .pi/mcp.json; do
  [[ -f "$bot_dir/$file" ]] || { printf 'Configure the worker before launch\n' >&2; exit 1; }
done
[[ -f "$root/assignment-worker/host.ts" && -d "$root/assignment-worker/node_modules" ]] || { printf 'Install the shared worker runtime dependencies first\n' >&2; exit 1; }
set -a
source "$env_file"
set +a
for key in SUPABASE_URL SUPABASE_SECRET_KEY; do
  [[ -n "${!key:-}" ]] || { printf 'Missing %s\n' "$key" >&2; exit 1; }
done
for key in $(compgen -v); do
  case "$key" in *TELEGRAM*|PI_SCHEDULER*) unset "$key";; esac
done
export AGENT_ROLE=worker PI_CODING_AGENT_DIR="$bot_dir/.pi"
export BATTUTA_MEMORY_URL="${BATTUTA_MEMORY_URL:-http://127.0.0.1:8901/mcp}"
cd "$bot_dir"
exec node --experimental-strip-types "$root/assignment-worker/host.ts" "$bot_dir"
