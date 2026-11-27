---
name: battuta-verify
description: Use when selecting Battuta formatting, lint, type, unit, coverage, or integration checks, writing tests, or verifying changed behavior before reporting completion.
---

# Battuta verification

Run commands from the repository root. Read [code checks](references/checks.md) for prerequisites, test discovery, CI, and commands. The shared [stack reference](../../../docs/tech-stack.md) explains runtime ownership, and the shared [command reference](../../../docs/commands.md) maps scripts to their responsibilities.

## Select checks

- Documentation/configuration: run `pnpm format:check`, check relative links, and validate configuration with its owning tool. For OpenCode changes, use the discovery checks in [OpenCode setup](../../../docs/opencode.md).
- Node code: run `pnpm lint:node`, `pnpm typecheck:node`, and `pnpm test:node`.
- Edge Functions: run `pnpm lint:deno`, `pnpm typecheck:deno`, and `pnpm test:deno`.
- Python, packaging, or shell changes: run `pnpm check:support`.
- Release build, packaging, setup, or service-generation changes: commit, then run `make check-release` with Docker running. It builds and installs the committed tree in containers; never run release install steps on the host.
- Database, mail transport, or cross-system behavior: run `pnpm test:integration` with Docker running. It uses an isolated Supabase stack; run only one integration check at a time.
- Before pushing code, run `make check`; use `make check-all` when integration verification is required.

## Test behavior and review coverage

1. Identify changed behavior, failure paths, and regressions. Exercise real internal logic; stub external services, clocks, and runtime boundaries.
2. Keep unit cases focused. Use table-driven/parameterized tests for equivalent inputs and outcomes; use integration tests for cross-system contracts.
3. Follow discovery conventions: Node `*.test.ts`, Node integration `*.integration.test.ts`, and co-located Deno `*.test.ts`.
4. For changed Node modules, run `pnpm test:coverage` and inspect `agent-mail/coverage/` and `project-spec/coverage/` (text, LCOV, and JSON summary). They include untested owned modules. Review uncovered branches against requirements; add meaningful missing cases. This command does not measure Python or Deno coverage—review their cases separately.
5. Report the checks actually run, their results, and any unverified behavior. Read failure logs in `.reports/` when integration checks fail.

## Write Python tests

Layout, markers, and run commands are in [code checks](references/checks.md); these rules cover how to write the tests.

- Use pytest with plain `assert`, `tmp_path`, and fixtures; use `unittest.mock` (`MagicMock`, `patch`) for doubles. No `unittest.TestCase` or `subTest`.
- Unit tests go in `tests/unit/`; anything crossing packages or processes goes in `tests/integration/` with the `integration` marker.
- Collapse equivalent cases into `pytest.mark.parametrize` with readable `ids`.
- Patch only the package's own import seams (the names the code under test imports), and stub every third-party binary, service, and clock. Never patch the logic under test.
- Unit tests never import a sibling package or its fixtures; duplicate small helpers package-locally. Prove cross-package wiring in integration tests (for example, the artifact boundary tests).
- Do not test constant or prompt text; test the behavior that consumes it.
- Describe integration journeys as Given/When/Then scenarios (pytest-bdd) in services that need no third-party service: `artifact-service` (always runs) and `memory-service` (opt-in with `BATTUTA_MEMORY_INTEGRATION=1`, with only the Claude call mocked).
