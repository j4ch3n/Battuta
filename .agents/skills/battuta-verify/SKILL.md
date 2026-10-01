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
- Database, mail transport, or cross-system behavior: run `pnpm test:integration` with Docker running. It uses an isolated Supabase stack; run only one integration check at a time.
- Before pushing code, run `make check`; use `make check-all` when integration verification is required.

## Test behavior and review coverage

1. Identify changed behavior, failure paths, and regressions. Exercise real internal logic; stub external services, clocks, and runtime boundaries.
2. Keep unit cases focused. Use table-driven/parameterized tests for equivalent inputs and outcomes; use integration tests for cross-system contracts.
3. Follow discovery conventions: Node `*.test.ts`, Node integration `*.integration.test.ts`, and co-located Deno `*.test.ts`.
4. For changed Node modules, run `pnpm test:coverage` and inspect `agent-mail/coverage/` (text, LCOV, and JSON summary). It includes untested owned modules. Review uncovered branches against requirements; add meaningful missing cases. This command does not measure Python or Deno coverage—review their cases separately.
5. Report the checks actually run, their results, and any unverified behavior. Read failure logs in `.reports/` when integration checks fail.
