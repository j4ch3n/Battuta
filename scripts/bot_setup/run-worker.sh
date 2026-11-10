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
[[ ! -L "$bot_dir" && ! -L "$bot_dir/.pi" ]] || { printf 'Worker home must be a private local directory\n' >&2; exit 1; }
workers="$(uv run --project "$root/scripts/bot_setup" --locked battuta-bot-setup workers --env-file "$env_file")"
selected=false
while IFS= read -r worker; do
  [[ "$worker" != "$(basename "$bot_dir")" ]] || selected=true
done <<< "$workers"
[[ "$selected" == true ]] || { printf 'Worker is outside the configured WORKER_BOT_COUNT\n' >&2; exit 1; }
cli="$root/bots/worker/extension/assignment-worker/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"
[[ -f "$cli" ]] || { printf 'Prepare the source worker profile and shared dependencies first\n' >&2; exit 1; }
set -a
source "$env_file"
set +a
for key in SUPABASE_URL SUPABASE_SECRET_KEY; do
  [[ -n "${!key:-}" ]] || { printf 'Missing %s\n' "$key" >&2; exit 1; }
done
mcp_source="$root/bots/worker/.pi/mcp.json"
if [[ ! -e "$bot_dir/.pi/mcp.json" && ! -L "$bot_dir/.pi/mcp.json" && ! -f "$mcp_source" ]]; then
  printf 'Missing generated worker MCP configuration. From the source root run:\n  uv run --project scripts/bot_setup --locked battuta-bot-setup configure --root . --role worker --env-file %q\n' "$env_file" >&2
  exit 1
fi
mkdir -p "$bot_dir/.pi"
if [[ ! -e "$bot_dir/.pi/settings.json" && ! -L "$bot_dir/.pi/settings.json" ]]; then
  node --input-type=module - "$root/bots/worker/.pi/settings.json" "$bot_dir/.pi/settings.json" <<'JS'
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const [source, target] = process.argv.slice(2);
const settings = JSON.parse(readFileSync(source, "utf8"));
// Native resource paths are relative to the source settings, not the private instance.
const rebase = (value) => /^(?:[a-z]+:|\/|~)/i.test(value) ? value : resolve(dirname(source), value);
for (const key of ["extensions", "skills", "packages"]) {
  if (settings[key]) settings[key] = settings[key].map((entry) =>
    typeof entry === "string" ? rebase(entry) : { ...entry, source: rebase(entry.source) });
}
writeFileSync(target, JSON.stringify(settings, null, 2) + "\n", { flag: "wx", mode: 0o600 });
JS
  uv run --project "$root/scripts/bot_setup" --locked battuta-bot-setup configure-browser --profile "$root/bots/worker" --bot-dir "$bot_dir" --bot "$(basename "$bot_dir")"
fi
if [[ ! -e "$bot_dir/.pi/mcp.json" && ! -L "$bot_dir/.pi/mcp.json" ]]; then
  cp -n "$mcp_source" "$bot_dir/.pi/mcp.json"
fi
if [[ -f "$root/bots/worker/.pi/web-search.json" && ! -e "$bot_dir/.pi/web-search.json" && ! -L "$bot_dir/.pi/web-search.json" ]]; then
  cp -n "$root/bots/worker/.pi/web-search.json" "$bot_dir/.pi/web-search.json"
fi
bot_dir="$(cd "$bot_dir" && pwd)"
for key in $(compgen -v); do
  case "$key" in *TELEGRAM*|PI_SCHEDULER*) unset "$key";; esac
done
export AGENT_ROLE=worker PI_CODING_AGENT_DIR="$bot_dir/.pi"
export BATTUTA_MEMORY_URL="${BATTUTA_MEMORY_URL:-http://127.0.0.1:8901/mcp}"
cd "$bot_dir"
exec uv run --project "$root/scripts/bot_setup" --locked battuta-bot-setup run-worker --root "$root" --bot-dir "$bot_dir" --env-file "$env_file" --node "$(command -v node)"
