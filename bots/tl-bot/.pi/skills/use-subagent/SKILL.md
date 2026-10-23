---
name: use-subagent
description: Use when delegating bounded local-source scouting, implementation or independent review, or inspecting or stopping a child.
---

# Use a subagent

Always delegate code changes to an implementation subagent. Read the ticket and relevant code before dispatch. Brief the worker on the goal, acceptance criteria, owned files or area, relevant constraints, expected checks, and decisions to raise before proceeding. Ask an independent reviewer to examine meaningful changes for correctness, regressions, and acceptance criteria. Inspect the diff and checks yourself; send specific findings to the worker and verify fixes.

Use `bounded_subagents` for focused tasks with explicit objective, supplied inputs,
scope and expected evidence. Scout and reviewer are read-only. Worker edits only
an operator-authorized disposable snapshot, not the real repository.

1. Keep product coordination with PM and engineering accountability with TL.
2. Give each child a distinct bounded question or change, relevant inputs,
   explicit exclusions, and the evidence needed to judge the result.
3. Launch one task or a small independent batch. Background completion and
   failures return automatically; inspect or cancel by child ID.
4. Independently inspect snapshot edits and verify before applying changes or
   accepting work. Never automatically merge, publish canonical documents or
   release based on child output.

Children have local file tools only, no shell, network research, memory writes,
owner messaging, inherited integrations or nested delegation. TL must perform
tests or external research when a child cannot supply that evidence. If no
operator grant is configured, report the delegation blocker rather than silently
using an unrestricted fallback. See [tool usage](references/tools.md).
