#!/usr/bin/env bash
set -euo pipefail

bot_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo_dir="$(dirname "$(dirname "$bot_dir")")"
tl_dir="$repo_dir/bots/tl-bot"
mode="${1:-}"
case "$mode" in
  dev)
    session="battuta-dev"
    env_file="$repo_dir/.env"
    ;;
  prod)
    session="battuta-prod"
    env_file="$repo_dir/.env.prod"
    ;;
  *)
    printf 'Usage: %s dev|prod\n' "$0" >&2
    exit 2
    ;;
esac

programs=(tmux)
if [[ "$mode" == dev ]]; then
  programs+=(supabase make)
fi
for program in "${programs[@]}"; do
  command -v "$program" >/dev/null || { printf '%s is required\n' "$program" >&2; exit 1; }
done

if tmux has-session -t "=$session" 2>/dev/null; then
  if [[ -n "${TMUX:-}" ]]; then
    tmux switch-client -t "=$session"
  else
    tmux attach-session -t "=$session"
  fi
  exit 0
fi

if [[ "$mode" == dev ]]; then
  [[ -f "$repo_dir/supabase/.env" ]] || { printf 'Missing supabase/.env; copy supabase/.env.example\n' >&2; exit 1; }
fi
[[ -x "$bot_dir/node_modules/.bin/pi" ]] || { printf 'Pi is not installed; run make setup-pm-bot\n' >&2; exit 1; }
[[ -f "$bot_dir/.pi/telegram.json" ]] || { printf 'Telegram is not configured; run make setup-pm-bot\n' >&2; exit 1; }
[[ -f "$bot_dir/.pi/mcp.json" ]] || { printf 'Project management MCP is not configured; run make setup-pm-bot\n' >&2; exit 1; }
[[ -f "$bot_dir/AGENTS.md" ]] || { printf 'PM instructions are not configured; run make setup-pm-bot\n' >&2; exit 1; }
[[ -x "$tl_dir/node_modules/.bin/pi" ]] || { printf 'TL Pi is not installed; run make setup-tl-bot\n' >&2; exit 1; }
[[ -f "$tl_dir/.pi/telegram.json" ]] || { printf 'TL Telegram is not configured; run make setup-tl-bot\n' >&2; exit 1; }
[[ -f "$tl_dir/.pi/mcp.json" ]] || { printf 'TL Linear MCP is not configured; run make setup-tl-bot\n' >&2; exit 1; }
[[ -f "$tl_dir/AGENTS.md" ]] || { printf 'TL instructions are not configured; run make setup-tl-bot\n' >&2; exit 1; }
[[ -f "$env_file" ]] || { printf 'Missing %s; copy .env.example and set the appropriate Supabase credentials\n' "$env_file" >&2; exit 1; }

set -a
source "$env_file"
set +a
[[ -n "${LINEAR_API_TOKEN:-}" ]] || { printf 'Set LINEAR_API_TOKEN in %s\n' "$env_file" >&2; exit 1; }
for key in SUPABASE_URL SUPABASE_SECRET_KEY; do
  [[ -n "${!key:-}" ]] || { printf 'Set %s in %s\n' "$key" "$env_file" >&2; exit 1; }
done
[[ -d "$repo_dir/agent-mail/node_modules" ]] || { printf 'Install agent-mail dependencies with pnpm --dir agent-mail install\n' >&2; exit 1; }
[[ -d "$repo_dir/project-spec/node_modules" ]] || { printf 'Install project-spec dependencies with pnpm --dir project-spec install --frozen-lockfile\n' >&2; exit 1; }

printf -v pi_command 'set -a; source %q; set +a; AGENT_ROLE=pm PI_CODING_AGENT_DIR=%q exec %q --approve --continue --session-dir %q --extension %q --extension %q' "$env_file" "$bot_dir/.pi" "$bot_dir/node_modules/.bin/pi" "$bot_dir/.pi/mail-sessions" "$repo_dir/agent-mail/index.ts" "$repo_dir/project-spec/index.ts"
printf -v tl_command 'set -a; source %q; set +a; AGENT_ROLE=tl PI_CODING_AGENT_DIR=%q exec %q --approve --continue --session-dir %q --extension %q --extension %q' "$env_file" "$tl_dir/.pi" "$tl_dir/node_modules/.bin/pi" "$tl_dir/.pi/mail-sessions" "$repo_dir/agent-mail/index.ts" "$repo_dir/project-spec/index.ts"
pi_pane="$(tmux new-session -d -P -F '#{pane_id}' -s "$session" -n "$mode" -c "$bot_dir" "$pi_command")"
if [[ "$mode" == dev ]]; then
  tmux split-window -v -p 30 -t "$pi_pane" -c "$repo_dir" 'exec make functions-serve'
fi
tmux split-window -h -t "$pi_pane" -c "$tl_dir" "$tl_command"
tmux select-pane -t "$pi_pane"

if [[ -n "${TMUX:-}" ]]; then
  tmux switch-client -t "=$session"
else
  tmux attach-session -t "=$session"
fi
