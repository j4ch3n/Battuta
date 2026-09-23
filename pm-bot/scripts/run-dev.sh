#!/usr/bin/env bash
set -euo pipefail

bot_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo_dir="$(dirname "$bot_dir")"
session="battuta-pm-bot"

for program in tmux supabase make; do
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

[[ -f "$repo_dir/supabase/.env" ]] || { printf 'Missing supabase/.env; copy supabase/.env.example\n' >&2; exit 1; }
[[ -x "$bot_dir/node_modules/.bin/pi" ]] || { printf 'Pi is not installed; run make setup-pm-bot\n' >&2; exit 1; }
[[ -f "$bot_dir/.pi/telegram.json" ]] || { printf 'Telegram is not configured; run make setup-pm-bot\n' >&2; exit 1; }
[[ -f "$bot_dir/.pi/mcp.json" ]] || { printf 'Project management MCP is not configured; run make setup-pm-bot\n' >&2; exit 1; }
[[ -f "$repo_dir/.env" ]] || { printf 'Missing .env; copy .env.example\n' >&2; exit 1; }

set -a
source "$repo_dir/.env"
set +a
[[ -n "${LINEAR_API_KEY:-}" ]] || { printf 'Set LINEAR_API_KEY in .env\n' >&2; exit 1; }

printf -v pi_command 'set -a; source %q; set +a; PI_CODING_AGENT_DIR=%q exec %q --approve' "$repo_dir/.env" "$bot_dir/.pi" "$bot_dir/node_modules/.bin/pi"
pi_pane="$(tmux new-session -d -P -F '#{pane_id}' -s "$session" -n dev -c "$bot_dir" "$pi_command")"
tmux split-window -h -t "$pi_pane" -c "$repo_dir" 'exec make functions-serve'
tmux select-pane -t "$pi_pane"

if [[ -n "${TMUX:-}" ]]; then
  tmux switch-client -t "=$session"
else
  tmux attach-session -t "=$session"
fi
