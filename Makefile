SUPABASE_DIR := supabase
ENV_FILE := $(SUPABASE_DIR)/.env

.PHONY: help db-diff functions-serve setup-bot setup-pm-bot setup-tl-bot start-dev start-prod run-dev setup-checks format check check-all

help:
	@printf '%s\n' \
		'Available targets:' \
		'  make setup-checks     Install locked development tooling and Git hooks' \
		'  make format           Format repository-owned TypeScript and supported files' \
		'  make check            Format, lint, type-check, unit and supporting-code checks' \
		'  make check-all        Full checks including isolated local Supabase integration' \
		'  make db-diff NAME=name Create a migration from local schema changes' \
		'  make functions-serve   Serve Edge Functions with supabase/.env loaded' \
		'  make setup-pm-bot     Install Pi, Telegram, and project-management MCP' \
		'  make setup-tl-bot     Install TL Pi, Telegram, and Linear MCP' \
		'  make setup-bot        Set up both PM and TL bots' \
		'  make start-dev        Attach to the dev PM + TL + Supabase tmux session' \
		'  make start-prod       Attach to the prod PM + TL tmux session (remote Supabase)' \
		'  uv run python bots/pm-bot/scripts/configure-bot.py --help  PM bot setup options' \
		'  uv run python bots/tl-bot/scripts/configure-bot.py --help  TL setup options'

db-diff:
	@test -n "$(NAME)" || (printf '%s\n' 'Set NAME, for example: make db-diff NAME=create_tasks' >&2; exit 1)
	supabase db diff -f "$(NAME)"

functions-serve:
	@test -f "$(ENV_FILE)" || (printf '%s\n' 'Missing supabase/.env. Create it from supabase/.env.example.' >&2; exit 1)
	supabase functions serve --env-file "$(ENV_FILE)" --no-verify-jwt

setup-pm-bot:
	uv run --locked python bots/pm-bot/scripts/configure-bot.py
	pnpm --dir agent-mail install

setup-tl-bot:
	uv run --locked python bots/tl-bot/scripts/configure-bot.py
	pnpm --dir agent-mail install

setup-bot: setup-pm-bot setup-tl-bot

start-dev:
	bash bots/pm-bot/scripts/run-dev.sh dev

start-prod:
	bash bots/pm-bot/scripts/run-dev.sh prod

run-dev: start-dev

setup-checks:
	pnpm install --frozen-lockfile
	pnpm setup:checks

format:
	pnpm format

check:
	pnpm check

check-all:
	pnpm check:all
