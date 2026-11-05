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
[[ -n "$bot_dir" && -f "$env_file" ]] || { printf 'Worker directory and environment file are required\n' >&2; exit 1; }
cli="$root/bots/worker/extension/assignment-worker/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"
[[ -f "$cli" ]] || { printf 'Prepare the source worker profile and shared dependencies first\n' >&2; exit 1; }
set -a
source "$env_file"
set +a
for key in SUPABASE_URL SUPABASE_SECRET_KEY; do
  [[ -n "${!key:-}" ]] || { printf 'Missing %s\n' "$key" >&2; exit 1; }
done
if [[ ! -f "$bot_dir/AGENTS.md" || ! -f "$bot_dir/.pi/settings.json" || ! -f "$bot_dir/.pi/mcp.json" ]]; then
  for file in AGENTS.md .pi/settings.json .pi/mcp.json; do
    [[ ! -e "$bot_dir/$file" && ! -L "$bot_dir/$file" ]] || { printf 'Incomplete worker profile; configure it explicitly before launch\n' >&2; exit 1; }
  done
  setup="$root/scripts/packaging/.venv/bin/battuta-bot-setup"
  if [[ -x "$setup" ]]; then
    "$setup" configure-worker --root "$root" --bot-dir "$bot_dir"
  else
    command -v uv >/dev/null || { printf 'Install uv or configure the private worker profile first\n' >&2; exit 1; }
    uv run --project "$root/scripts/bot_setup" --locked battuta-bot-setup configure-worker --root "$root" --bot-dir "$bot_dir"
  fi
fi
bot_dir="$(cd "$bot_dir" && pwd)"
for key in $(compgen -v); do
  case "$key" in *TELEGRAM*|PI_SCHEDULER*) unset "$key";; esac
done
export AGENT_ROLE=worker PI_CODING_AGENT_DIR="$bot_dir/.pi"
export BATTUTA_MEMORY_URL="${BATTUTA_MEMORY_URL:-http://127.0.0.1:8901/mcp}"
cd "$bot_dir"
exec node "$cli"
