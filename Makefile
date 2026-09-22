SUPABASE_DIR := supabase
ENV_FILE := $(SUPABASE_DIR)/.env

.PHONY: help db-diff functions-serve

help:
	@printf '%s\n' \
		'Available targets:' \
		'  make db-diff NAME=name Create a migration from local schema changes' \
		'  make functions-serve   Serve Edge Functions with supabase/.env loaded'

db-diff:
	@test -n "$(NAME)" || (printf '%s\n' 'Set NAME, for example: make db-diff NAME=create_tasks' >&2; exit 1)
	supabase db diff -f "$(NAME)"

functions-serve:
	@test -f "$(ENV_FILE)" || (printf '%s\n' 'Missing supabase/.env. Create it from supabase/.env.example.' >&2; exit 1)
	supabase functions serve --env-file "$(ENV_FILE)" --no-verify-jwt
