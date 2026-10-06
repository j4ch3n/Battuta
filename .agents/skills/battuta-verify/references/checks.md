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
- `pnpm test:coverage`: Node unit coverage, including untested owned modules; reports are in `agent-mail/coverage/`, `project-spec/coverage/`, and `memory-stone/coverage/`.
- `pnpm --dir agent-mail test:watch`: watch-mode Node unit tests.
- `pnpm check:support`: packaging/shell syntax checks and Python test discovery under `scripts/tests/` and each `shared-skills/<skill>-cli/tests/` directory, using the corresponding package's locked environment.
- `pnpm test:integration`: an isolated local Supabase stack, migration replay, database lint, pgTAP permissions tests, and Vitest integration tests. Uses project `battuta-check`, ports `553xx` and inspector port `8183`; leaves the normal development stack alone. Run only one integration check at a time. Failure logs and JUnit results are in `.reports/`.

The pre-commit hook formats staged files, then lints staged code with its runtime-specific configuration. lint-staged preserves partially staged work. Run `make check` before pushing; full-project type checks cannot reliably be restricted to staged files.

Use `*.test.ts` for Node unit tests and `*.integration.test.ts` for Node integration tests; new tests are discovered automatically. Co-locate Deno `*.test.ts` files with their function. Every function directory must have `lint`, `check`, and `test` tasks in its `deno.json`; root commands discover directories automatically. Commit updated lockfiles when changing dependencies. CI uses frozen installs/checks.
