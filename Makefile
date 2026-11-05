SUPABASE_DIR := supabase

.PHONY: help db-diff functions-serve setup-bot setup-cos-bot setup-manager-bot refresh-telegram dev prod setup-checks format check check-all

help:
	@printf '%s\n' \
		'Available targets:' \
		'  make setup-checks     Install locked development tooling and Git hooks' \
		'  make format           Format repository-owned TypeScript and supported files' \
		'  make check            Format, lint, type-check, unit and supporting-code checks' \
		'  make check-all        Full checks including isolated local Supabase integration' \
		'  make db-diff NAME=name Create a migration from local schema changes' \
		'  make functions-serve   Serve Edge Functions with supabase/.env loaded' \
		'  make setup-cos-bot     Install Pi, Telegram, and project-management MCP' \
		'  make setup-manager-bot Install Manager Pi and Linear MCP (no Telegram)' \
		'  make setup-bot        Set up both CoS and Manager bots' \
		'  make refresh-telegram ENV_FILE=.env  Update CoS Telegram from an env file' \
		'  make dev              Attach to CoS, Manager, Worker + local services using .env' \
		'  make prod             Attach to prod bots using .env.prod (remote Supabase)' \
		'  uv run --project scripts/bot_setup --locked battuta-bot-setup configure --help  Bot setup options'

db-diff:
	@test -n "$(NAME)" || (printf '%s\n' 'Set NAME, for example: make db-diff NAME=create_tasks' >&2; exit 1)
	supabase db diff -f "$(NAME)"

functions-serve: ENV_FILE ?= $(SUPABASE_DIR)/.env
functions-serve:
	@test -f "$(ENV_FILE)" || (printf '%s\n' 'Missing supabase/.env. Create it from supabase/.env.example.' >&2; exit 1)
	supabase functions serve --env-file "$(ENV_FILE)" --no-verify-jwt

setup-cos-bot:
	uv run --project scripts/bot_setup --locked battuta-bot-setup configure --root . --role cos
	pnpm --dir agent-mail install
	pnpm --dir project-spec install --frozen-lockfile

setup-manager-bot:
	uv run --project scripts/bot_setup --locked battuta-bot-setup configure --root . --role manager
	pnpm --dir agent-mail install
	pnpm --dir project-spec install --frozen-lockfile
	pnpm --dir memory-client install --frozen-lockfile

setup-bot: setup-cos-bot setup-manager-bot

refresh-telegram: ENV_FILE ?= .env
refresh-telegram:
	uv run --project scripts/bot_setup --locked battuta-bot-setup refresh-telegram --root . "$(ENV_FILE)"

dev:
	bash bots/cos-bot/scripts/run-dev.sh dev

prod:
	bash bots/cos-bot/scripts/run-dev.sh prod

setup-checks:
	pnpm install --frozen-lockfile
	pnpm setup:checks

format:
	pnpm format

check:
	pnpm check

check-all:
	pnpm check:all
