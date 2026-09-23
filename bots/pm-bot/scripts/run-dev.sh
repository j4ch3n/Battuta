#!/usr/bin/env bash
set -euo pipefail

bot_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo_dir="$(dirname "$(dirname "$bot_dir")")"
tech_lead_dir="$repo_dir/bots/tech-lead-bot"
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
pm_pi_session_id="pm"
tech_lead_pi_session_id="tech-lead"

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
[[ -x "$tech_lead_dir/node_modules/.bin/pi" ]] || { printf 'Tech-lead Pi is not installed; run make setup-tech-lead-bot\n' >&2; exit 1; }
[[ -f "$tech_lead_dir/.pi/telegram.json" ]] || { printf 'Tech-lead Telegram is not configured; run make setup-tech-lead-bot\n' >&2; exit 1; }
[[ -f "$tech_lead_dir/.pi/mcp.json" ]] || { printf 'Tech-lead Linear MCP is not configured; run make setup-tech-lead-bot\n' >&2; exit 1; }
[[ -f "$tech_lead_dir/AGENTS.md" ]] || { printf 'Tech-lead instructions are not configured; run make setup-tech-lead-bot\n' >&2; exit 1; }
[[ -f "$env_file" ]] || { printf 'Missing %s; copy .env.example and set the appropriate Supabase credentials\n' "$env_file" >&2; exit 1; }

set -a
source "$env_file"
set +a
[[ -n "${LINEAR_API_KEY:-}" ]] || { printf 'Set LINEAR_API_KEY in .env\n' >&2; exit 1; }
for key in SUPABASE_URL SUPABASE_SECRET_KEY; do
  [[ -n "${!key:-}" ]] || { printf 'Set %s in .env\n' "$key" >&2; exit 1; }
done
[[ -d "$repo_dir/agent-mail/node_modules" ]] || { printf 'Install agent-mail dependencies with pnpm --dir agent-mail install\n' >&2; exit 1; }

printf -v pi_command 'set -a; source %q; set +a; AGENT_MAIL_IDENTITY=pm PI_CODING_AGENT_DIR=%q exec %q --approve --session-id %q --extension %q' "$env_file" "$bot_dir/.pi" "$bot_dir/node_modules/.bin/pi" "$pm_pi_session_id" "$repo_dir/agent-mail/index.ts"
printf -v tech_lead_command 'set -a; source %q; set +a; AGENT_MAIL_IDENTITY=tech-lead PI_CODING_AGENT_DIR=%q exec %q --approve --session-id %q --extension %q' "$env_file" "$tech_lead_dir/.pi" "$tech_lead_dir/node_modules/.bin/pi" "$tech_lead_pi_session_id" "$repo_dir/agent-mail/index.ts"
pi_pane="$(tmux new-session -d -P -F '#{pane_id}' -s "$session" -n "$mode" -c "$bot_dir" "$pi_command")"
if [[ "$mode" == dev ]]; then
  tmux split-window -v -p 30 -t "$pi_pane" -c "$repo_dir" 'exec make functions-serve'
fi
tmux split-window -h -t "$pi_pane" -c "$tech_lead_dir" "$tech_lead_command"
tmux select-pane -t "$pi_pane"

if [[ -n "${TMUX:-}" ]]; then
  tmux switch-client -t "=$session"
else
  tmux attach-session -t "=$session"
fi
