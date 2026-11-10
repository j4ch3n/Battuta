#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
bot_dir="$repo_dir/bots/cos-bot"
manager_dir="$repo_dir/bots/manager-bot"
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

programs=(tmux uv)
if [[ "$mode" == dev ]]; then
  programs+=(supabase make)
fi
for program in "${programs[@]}"; do
  command -v "$program" >/dev/null || { printf '%s is required\n' "$program" >&2; exit 1; }
done

[[ -f "$env_file" ]] || { printf 'Missing %s; create it from .env.example\n' "$env_file" >&2; exit 1; }
worker_list="$(uv run --project "$repo_dir/scripts/bot_setup" --locked battuta-bot-setup workers --env-file "$env_file")"

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
if [[ -n "$worker_list" ]]; then
  [[ -f "$repo_dir/bots/worker/extension/assignment-worker/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js" ]] || { printf 'Prepare the shared worker profile and dependencies first\n' >&2; exit 1; }
fi
[[ -x "$bot_dir/node_modules/.bin/pi" ]] || { printf 'Pi is not installed; run make setup-cos-bot\n' >&2; exit 1; }
[[ -f "$bot_dir/.pi/telegram.json" ]] || { printf 'Telegram is not configured; run make setup-cos-bot\n' >&2; exit 1; }
[[ -f "$bot_dir/.pi/mcp.json" ]] || { printf 'Project management MCP is not configured; run make setup-cos-bot\n' >&2; exit 1; }
[[ -f "$bot_dir/AGENTS.md" ]] || { printf 'CoS instructions are not configured; run make setup-cos-bot\n' >&2; exit 1; }
[[ -x "$manager_dir/node_modules/.bin/pi" ]] || { printf 'Manager Pi is not installed; run make setup-manager-bot\n' >&2; exit 1; }
[[ -f "$manager_dir/.pi/mcp.json" ]] || { printf 'Manager Linear MCP is not configured; run make setup-manager-bot\n' >&2; exit 1; }
[[ -f "$manager_dir/AGENTS.md" ]] || { printf 'Manager instructions are not configured; run make setup-manager-bot\n' >&2; exit 1; }
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
[[ -d "$repo_dir/memory-client/node_modules" ]] || { printf 'Install memory client dependencies with pnpm --dir memory-client install --frozen-lockfile\n' >&2; exit 1; }
memory_url="${BATTUTA_MEMORY_URL:-http://127.0.0.1:8901/mcp}"
if [[ -f "$repo_dir/artifact-service/pyproject.toml" ]]; then
  export PATH="$repo_dir/artifact-service/.venv/bin:$PATH"
fi
export PI_SCHEDULER_STATE_FILE
PI_SCHEDULER_STATE_FILE="$(node "$repo_dir/memory-client/configure-scheduler.mjs" --print-path)"
export PI_SCHEDULER_CATCHUP_MAX
PI_SCHEDULER_CATCHUP_MAX="$(node "$repo_dir/memory-client/configure-scheduler.mjs" --print-catchup)"
node "$repo_dir/memory-client/configure-scheduler.mjs" --check

printf -v pi_command 'set -e; set -a; source %q; set +a; umask 077; export PATH=%q; export PI_SCHEDULER_STATE_FILE; PI_SCHEDULER_STATE_FILE="$(node %q --print-path)"; export PI_SCHEDULER_CATCHUP_MAX; PI_SCHEDULER_CATCHUP_MAX="$(node %q --print-catchup)"; node %q --check; AGENT_ROLE=cos PI_CODING_AGENT_DIR=%q BATTUTA_MEMORY_URL=%q exec %q --approve --continue --session-dir %q --extension %q --extension %q --extension %q' "$env_file" "$PATH" "$repo_dir/memory-client/configure-scheduler.mjs" "$repo_dir/memory-client/configure-scheduler.mjs" "$repo_dir/memory-client/configure-scheduler.mjs" "$bot_dir/.pi" "$memory_url" "$bot_dir/node_modules/.bin/pi" "$bot_dir/.pi/mail-sessions" "$repo_dir/agent-mail/index.ts" "$repo_dir/project-spec/index.ts" "$repo_dir/memory-client/index.ts"
printf -v manager_command 'set -e; set -a; source %q; set +a; export PATH=%q; for key in $(compgen -v); do case "$key" in *TELEGRAM*) unset "$key";; esac; done; unset PI_SCHEDULER_STATE_FILE PI_SCHEDULER_CATCHUP_MAX; AGENT_ROLE=manager PI_CODING_AGENT_DIR=%q BATTUTA_MEMORY_URL=%q exec %q --approve --continue --session-dir %q --extension %q --extension %q' "$env_file" "$PATH" "$manager_dir/.pi" "$memory_url" "$manager_dir/node_modules/.bin/pi" "$manager_dir/.pi/mail-sessions" "$repo_dir/agent-mail/index.ts" "$repo_dir/project-spec/index.ts"
# tmux's default shell may be zsh; credential scrubbing uses Bash builtins.
printf -v manager_command 'exec bash -c %q' "$manager_command"
bot_window="$mode"
service_window="memory"
if [[ "$mode" == dev ]]; then
  bot_window="bots"
  service_window="services"
fi
pi_pane="$(tmux new-session -d -P -F '#{pane_id}' -s "$session" -n "$bot_window" -c "$bot_dir" "$pi_command")"
manager_pane="$(tmux split-window -h -P -F '#{pane_id}' -t "$pi_pane" -c "$manager_dir" "$manager_command")"
printf -v memory_command 'set -a; source %q; set +a; export PATH=%q; exec %q serve' "$env_file" "$PATH" "$repo_dir/memory-service/.venv/bin/battuta-memory"
memory_pane="$(tmux new-window -P -F '#{pane_id}' -t "=$session" -n "$service_window" -c "$repo_dir" "$memory_command")"
if [[ "$mode" == dev ]]; then
  tmux split-window -h -t "$memory_pane" -c "$repo_dir" 'exec make functions-serve'
  tmux select-layout -t "$memory_pane" even-horizontal
fi
while IFS= read -r worker; do
   [[ -n "$worker" ]] || continue
   worker_dir="$HOME/.battuta/pi-bots/$worker"
  printf -v worker_command 'set -e; set -a; source %q; set +a; node %q; exec bash %q --bot-dir %q --env-file %q' "$env_file" "$repo_dir/scripts/bot_setup/wait-for-assignments.mjs" "$repo_dir/scripts/bot_setup/run-worker.sh" "$worker_dir" "$env_file"
  printf -v worker_command 'exec bash -c %q' "$worker_command"
  mkdir -p "$worker_dir"
  worker_pane="$(tmux split-window -h -P -F '#{pane_id}' -t "$manager_pane" -c "$worker_dir" "$worker_command")"
  tmux select-pane -t "$worker_pane" -T "$worker"
done <<< "$worker_list"
tmux select-layout -t "$pi_pane" even-horizontal
tmux select-window -t "$pi_pane"
tmux select-pane -t "$pi_pane"

if [[ -n "${TMUX:-}" ]]; then
  tmux switch-client -t "=$session"
else
  tmux attach-session -t "=$session"
fi
