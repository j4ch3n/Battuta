# Developer checks

Thin Node runners coordinate repository checks; they are not bot runtime code.

| File                   | Purpose                                                                  |
| ---------------------- | ------------------------------------------------------------------------ |
| `check-deno.mjs`       | Run lint, type checks, or tests for every Edge Function.                 |
| `check-supabase.mjs`   | Run database and integration checks against an isolated temporary stack. |
| `check-support.mjs`    | Run shell checks and each Python project's tests in its own environment. |
| `lint-staged-code.mjs` | Send staged code to ESLint or Deno lint during commits.                  |

See [development commands](../../docs/commands.md) for the maintained command reference.
