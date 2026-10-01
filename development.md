# Local development

Run the Project Manager and Tech Lead bots from a source checkout with Python **3.12+**, uv, Node.js **22+**, pnpm **10.20.x**, and tmux. Local Supabase also needs Docker and the Supabase CLI; a remote Supabase project does not.

## Code checks

Install Node.js from `.node-version`, pnpm **10.20.0**, Deno from `.deno-version`, Python **3.12+**, uv, and the Supabase CLI version from `.supabase-version`. Docker must be running for integration checks.

```sh
make setup-checks
make check
make check-all
```

`make setup-checks` installs locked root tooling and package dependencies, enables the Husky Git hook, and installs Python dependencies. It does not configure or launch the bots. Packages and Edge Functions keep separate lockfiles.

- `pnpm format` / `pnpm format:check`: Prettier formatting for repository-owned TypeScript/JavaScript, JSON, YAML, and Markdown, including Edge Functions.
- `pnpm lint`: typed ESLint for Node modules and Deno lint for each function.
- `pnpm typecheck`: TypeScript compiler checks for Node extensions and Deno checks for all function modules and tests.
- `pnpm test:unit`: Vitest Node unit tests and Deno-native function tests.
- `pnpm test:coverage`: Node unit coverage, including untested owned modules; reports are in `agent-mail/coverage/`.
- `pnpm --dir agent-mail test:watch`: watch-mode Node unit tests.
- `pnpm check:support`: Python unit tests and packaging/shell syntax checks.
- `pnpm test:integration`: an isolated local Supabase stack, migration replay, database lint, pgTAP permissions tests, and Vitest integration tests. Uses project `battuta-check`, ports `553xx` and inspector port `8183`; leaves the normal development stack alone. Run only one integration check at a time. Failure logs and JUnit results are in `.reports/`.

The pre-commit hook formats staged files, then lints staged code with its runtime-specific configuration. lint-staged preserves partially staged work. Run `make check` before pushing; full-project type checks cannot reliably be restricted to staged files.

Use `*.test.ts` for Node unit tests and `*.integration.test.ts` for Node integration tests; new tests are discovered automatically. Co-locate Deno `*.test.ts` files with their function. Every function directory must have `lint`, `check`, and `test` tasks in its `deno.json`; root commands discover directories automatically. Commit updated lockfiles when changing dependencies. CI uses frozen installs/checks.

Install the recommended VS Code extensions. Deno language support is scoped to `supabase/functions`, while Prettier handles formatting for both runtimes. Do not run `deno fmt` on Prettier-owned files.

GitHub Actions checks every branch push and PR, and merge queue candidates. Formatting runs first, followed by parallel Node, Deno, integration and supporting-code jobs. `Quality gate` fails if any required job fails or is skipped. Production deployment and tagged releases call the same validation workflow before proceeding. The default branch ruleset must require the `Quality gate` check.

## Bot configuration

For local Supabase, copy `.env.example` to `.env` and `supabase/.env.example` to `supabase/.env`. Restrict both to mode `600` and fill in the two Telegram bot tokens, allowed Telegram user ID, Linear API key, and Supabase credentials. The local functions environment also needs the Linear webhook secret and API key. For remote Supabase development, copy `.env.example` to `.env.prod` instead, restrict it to mode `600`, and set it to the deployed project's URL and secret key. Keep these files out of source control. The [release guide](release.md#4-prepare-production-credentials) describes the production credential fields in more detail.

For local Supabase, start Docker and run `supabase start`, then copy its URL and server-side secret key into `.env`. For remote Supabase, ensure migrations and Edge Functions have already been deployed.

## Run

```sh
uv sync --locked
make setup-bot
make start-dev
```

`make start-dev` attaches the Project Manager, Tech Lead, and Edge Functions panes; it expects local Supabase to be running already. Use `make start-prod` instead when connecting to remote Supabase with `.env.prod` (it runs the two bots only). Do not run dev and prod modes concurrently from the same checkout; they share Pi state.

Complete `/login` in each Pi pane, then message both Telegram bots. Detach with `Ctrl-b d` and rerun the same Make target to reattach. See the [release guide](release.md#5-configure-and-verify-interactively) for a more detailed verification walkthrough.
