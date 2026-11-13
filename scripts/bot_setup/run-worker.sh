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
exec uv run --project "$root/scripts/bot_setup" --locked battuta-bot-setup run-worker --root "$root" --bot-dir "$bot_dir" --env-file "$env_file" --node "$(command -v node)"
