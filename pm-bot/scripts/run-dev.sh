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

printf -v pi_command 'PI_CODING_AGENT_DIR=%q exec %q --approve' "$bot_dir/.pi" "$bot_dir/node_modules/.bin/pi"
pi_pane="$(tmux new-session -d -P -F '#{pane_id}' -s "$session" -n dev -c "$bot_dir" "$pi_command")"
tmux split-window -h -t "$pi_pane" -c "$repo_dir" 'exec make functions-serve'
tmux select-pane -t "$pi_pane"

if [[ -n "${TMUX:-}" ]]; then
  tmux switch-client -t "=$session"
else
  tmux attach-session -t "=$session"
fi
