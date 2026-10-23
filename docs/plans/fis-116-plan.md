# Bounded TL subagents implementation plan

> **For agentic workers:** Use executing-plans inline. Track each deliverable below.

**Goal:** Enable bounded, attributable and authority-restricted TL child work.

**Architecture:** Adapt pi-subagents' public delegation events inside private owned
processes. A TL-only facade controls admission, snapshots and lifecycle; scoped
tools enforce authority rather than relying on profile prompts.

**Tech Stack:** Node, TypeScript, Pi 1.3.0, pi-subagents 0.81.0, Vitest.

**Spec:** [Design](fis-116-design.md).

## Global constraints

- Work only in the assigned `agent/fis-116-bounded-subagents` worktree.
- No PM installation, unrestricted shell, inherited credentials or nested children.
- Preserve existing settings, plugins and private runtime data.
- No instruction-wording tests or claims of live Telegram verification from mocks.

## Review focus

- Traversal, symlinks and private input paths must be rejected before launch.
- Concurrent/batch admission cannot exceed either configured bound.
- Missing usage is unavailable, not fabricated zero-cost work.
- Shutdown/cancel must stop running processes, not merely mark them stopped.
- Existing custom settings and PM setup must remain unchanged.

## Tasks

### 1. Snapshot authority and configuration

Files: TL `bounded-subagents/policy.ts`, `policy.test.ts` and pinned dependencies.
Interface: validate operator config; create disposable scoped task snapshots.

- [x] Write failing table-driven tests for invalid limits, private paths, symlinks,
      outside-root inputs and unauthorized writes; run and observe RED.
- [x] Implement strict config validation and snapshot creation; run GREEN.

### 2. Real upstream delegation and scoped tools

Files: `broker.ts`, `child-tools.ts`, headless integration tests.
Interface: private process accepts one JSON request and emits upstream terminal JSON.

- [x] Write failing tests using a local OpenAI-compatible provider for tool
      selection, read/write isolation, successful results and provider failure.
- [x] Implement public delegation events, explicit profiles and scoped tools.
- [x] Exercise actual pinned Pi/upstream; retain accurate compatibility evidence.

### 3. TL lifecycle facade

Files: extension `index.ts`, `runtime.ts`, lifecycle tests and runtime skill.
Interface: launch foreground/background single or bounded parallel; inspect/cancel.

- [x] Write failing tests for admission, attribution, cancellation, deadlines,
      output bounds and parent shutdown.
- [x] Implement admission and owned-process cleanup; verify GREEN.

### 4. Setup, release and verification

Files: TL setup, release assembly, package/check wiring, focused references.

- [x] Add executable setup/release regression tests.
- [x] Wire TL-only installation without changing unrelated settings.
- [x] Run targeted tests, coverage and `make check`; document actual failures.
- [ ] Self-review, update checklist, commit/push and open separate PR against main.

## Execution ledger

- Baseline: existing `pnpm test:node` passed before changes.
- Ruling: use owned foreground delegation for both facade modes, avoiding upstream
  background ambient-extension inheritance and detached-runner lifecycle complexity.
- Live deployed Telegram acceptance is not authorized in this isolated worktree;
  leave explicit instructions and report the remaining acceptance step.
- Task 1 complete: strict path/size/config grants and private snapshots; dangling
  symlink regression observed RED then GREEN.
- Task 2 complete: actual Pi 1.3.0 + upstream 0.81.0 delegation succeeded against
  a local HTTP/SSE provider. Native child startup adds `contact_supervisor` even
  with explicit tool lists; the child execution gate and active selection exclude
  it. Real provider rejection is tested; failed-run normalized zero usage is omitted.
- Task 3 complete: headless Pi registered-tool tests cover foreground/background,
  notification delivery, inspect, cancellation and session shutdown. Actual active
  provider requests are cancelled/timed out; processes are reaped. Per-task grants,
  batch/lifetime limits, attribution, and oversized-result failures are covered.
- Task 4 verification: `make check` passed (297 Node tests, 5 Deno tests,
  support/service/CLI suites). `pnpm test:coverage` passed; adapter measured line
  coverage 93.71%, branches 86.04%. Broker runs in real subprocesses and is excluded
  from parent-process coverage instrumentation, not from behavioral tests.
- Self-review fixed task-specific file narrowing, cancelled-process capacity
  accounting, dangling symlinks, oversized failure classification and unavailable
  failure usage. Regression cases passed.
- Independent read-only review of `5dfb8f7..1d61e12` found one Important usage
  availability bug and no critical security issues. A successful real-runtime SSE
  stream without usage reproduced normalized zero counters (RED). The adapter now
  conservatively omits all-zero/unverifiable counters even on completion (GREEN).
  All 39 TL tests and repository checks passed after the fix. Parent re-review is
  pending; no additional reviewer was spawned.
- Ruling: use the existing `use-subagent` runtime skill instead of introducing a
  competing skill; preserve custom skill content. Cost if wrong: operators with
  custom skills must incorporate the new command usage themselves.
- Ruling: intentionally support local-source children and a dedicated
  OpenAI-compatible endpoint only. No inherited research adapters/OAuth/shell.
  Cost if wrong: unsupported provider or external research needs remain with TL.
- No database changes: Supabase/Docker integration and full Linux-arm64 release
  assembly were not run. Executable release boundary/import/license checks passed.
- Existing memory-service deprecation warnings and artifact-service resource
  warnings appeared in passing support suites; no unrelated fixes were made.
