SUPABASE_DIR := supabase

.PHONY: help db-diff functions-serve setup-bot setup-pm-bot setup-tl-bot refresh-telegram dev prod setup-checks format check check-all

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
		'  make refresh-telegram ENV_FILE=.env  Update both Telegram profiles from an env file' \
		'  make dev              Attach to dev bots + Supabase using .env' \
		'  make prod             Attach to prod bots using .env.prod (remote Supabase)' \
		'  uv run python bots/pm-bot/scripts/configure-bot.py --help  PM bot setup options' \
		'  uv run python bots/tl-bot/scripts/configure-bot.py --help  TL setup options'

db-diff:
	@test -n "$(NAME)" || (printf '%s\n' 'Set NAME, for example: make db-diff NAME=create_tasks' >&2; exit 1)
	supabase db diff -f "$(NAME)"

functions-serve: ENV_FILE ?= $(SUPABASE_DIR)/.env
functions-serve:
	@test -f "$(ENV_FILE)" || (printf '%s\n' 'Missing supabase/.env. Create it from supabase/.env.example.' >&2; exit 1)
	supabase functions serve --env-file "$(ENV_FILE)" --no-verify-jwt

setup-pm-bot:
	uv run --locked python bots/pm-bot/scripts/configure-bot.py
	pnpm --dir agent-mail install
	pnpm --dir project-spec install --frozen-lockfile

setup-tl-bot:
	uv run --locked python bots/tl-bot/scripts/configure-bot.py
	pnpm --dir agent-mail install
	pnpm --dir project-spec install --frozen-lockfile

setup-bot: setup-pm-bot setup-tl-bot

refresh-telegram: ENV_FILE ?= .env
refresh-telegram:
	uv run --locked python scripts/refresh-telegram.py "$(ENV_FILE)"

dev:
	bash bots/pm-bot/scripts/run-dev.sh dev

prod:
	bash bots/pm-bot/scripts/run-dev.sh prod

setup-checks:
	pnpm install --frozen-lockfile
	pnpm setup:checks

format:
	pnpm format

check:
	pnpm check

check-all:
	pnpm check:all
