SUPABASE_DIR := supabase
ENV_FILE := $(SUPABASE_DIR)/.env

.PHONY: help db-diff functions-serve setup-bot setup-pm-bot setup-tech-lead-bot run-dev

help:
	@printf '%s\n' \
		'Available targets:' \
		'  make db-diff NAME=name Create a migration from local schema changes' \
		'  make functions-serve   Serve Edge Functions with supabase/.env loaded' \
		'  make setup-pm-bot     Install Pi, Telegram, and project-management MCP' \
		'  make setup-tech-lead-bot  Install tech-lead Pi, Telegram, and Linear MCP' \
		'  make setup-bot        Set up both PM and tech-lead bots' \
		'  make run-dev          Attach to the PM + tech-lead + Supabase tmux session' \
		'  uv run python pm-bot/scripts/configure-bot.py --help  PM bot setup options' \
		'  uv run python tech-lead-bot/scripts/configure-bot.py --help  Tech-lead setup options'

db-diff:
	@test -n "$(NAME)" || (printf '%s\n' 'Set NAME, for example: make db-diff NAME=create_tasks' >&2; exit 1)
	supabase db diff -f "$(NAME)"

functions-serve:
	@test -f "$(ENV_FILE)" || (printf '%s\n' 'Missing supabase/.env. Create it from supabase/.env.example.' >&2; exit 1)
	supabase functions serve --env-file "$(ENV_FILE)" --no-verify-jwt

setup-pm-bot:
	uv run --locked python pm-bot/scripts/configure-bot.py
	pnpm --dir agent-mail install

setup-tech-lead-bot:
	uv run --locked python tech-lead-bot/scripts/configure-bot.py
	pnpm --dir agent-mail install

setup-bot: setup-pm-bot setup-tech-lead-bot

run-dev:
	bash pm-bot/scripts/run-dev.sh
