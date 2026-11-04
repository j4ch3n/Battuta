# Code checks

Run commands from the repository root. Contributor tooling must already be installed with `make setup-checks`: Node.js from `.node-version`, pnpm **10.20.0**, Deno from `.deno-version`, Python **3.12+**, uv, and the Supabase CLI version from `.supabase-version`. Docker must be running for integration checks.

```sh
make check
make check-all
```

- `pnpm format` / `pnpm format:check`: Prettier formatting for repository-owned TypeScript/JavaScript, JSON, YAML, and Markdown, including Edge Functions.
- `pnpm lint`: typed ESLint for Node modules and Deno lint for each function.
- `pnpm typecheck`: TypeScript compiler checks for Node extensions and Deno checks for all function modules and tests.
- `pnpm test:unit`: Vitest Node unit tests and Deno-native function tests.
- `pnpm test:coverage`: Node unit coverage, including untested owned modules; reports are in `agent-mail/coverage/`, `project-spec/coverage/`, `memory-client/coverage/`, and `assignment-worker/coverage/`. Worker Pi lifecycle/backend composition is also exercised by integration tests with loopback provider stubs, not live models.
- `pnpm --dir agent-mail test:watch`: watch-mode Node unit tests.
- `uv run --project memory-service --locked python -m unittest discover -s memory-service/tests -v`: offline Python memory tests. Model provisioning and Pi hardware checks are separate installation run-throughs, not default CI acceptance.
- `pnpm check:support`: shell syntax checks and Python suites under `scripts/bot_setup/tests/`, `scripts/packaging/tests/`, service packages, and `project-context-cli/tests/`, each using its owning locked uv environment. Test workspaces and integration reports live under `/tmp` (canonicalized on macOS), not the checkout. Launcher/setup tests invoke the real Node scheduler helper, so standalone support jobs also need `pnpm --dir memory-client install --frozen-lockfile --prod` (already covered by `make setup-checks`).
- Python unit tests use `test_*.py`; integration tests use `<subject>.it.py` and end with `unittest.main()` so they run directly. `pnpm check:support` runs unit discovery and each integration script in its package's locked environment. Existing opt-in integration gates still apply. To run only a particular integration: `uv run --project <package> --locked python <package>/tests/<subject>.it.py`. Bare unittest discovery does not include dotted integration filenames. Project CLI integration covers supported project commands and preservation of opaque metadata and working files.
- `pnpm test:integration`: an isolated local Supabase stack, migration replay, database lint, pgTAP permissions tests, and Vitest integration tests. Uses project `battuta-check`, ports `553xx` and inspector port `8183`; leaves the normal development stack alone. Run only one integration check at a time. The runner prints its retained `/tmp/battuta-check-reports-*` log/JUnit directory.
- `pnpm test:assignments:local`: explicitly uses the already running checkout-local Supabase instance for assignment database/MCP integration. Apply additive migrations and serve the function first. It never resets, starts, migrates, or stops the instance; tests delete only their own records. `supabase test db` runs permissions checks in rolled-back transactions. Never use a production endpoint or display the status JSON containing credentials. The normal isolated integration runner also executes assignment lint/types/database/MCP tests for CI.

The pre-commit hook validates staged skill manifests and catalog entry points, then formats staged files and lints staged code with its runtime-specific configuration. lint-staged preserves partially staged work. `pnpm check:skills` validates all profile selections in the checkout. Run `make check` before pushing; full-project type checks cannot reliably be restricted to staged files.

Use `*.test.ts` for Node unit tests and `*.integration.test.ts` for Node integration tests; new tests are discovered automatically. Co-locate Deno `*.test.ts` files with their function. Every function directory must have `lint`, `check`, and `test` tasks in its `deno.json`; root commands discover directories automatically. Commit updated lockfiles when changing dependencies. CI uses frozen installs/checks.
