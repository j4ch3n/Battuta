---
name: battuta-setup
description: Use when setting up Battuta development dependencies or configuring and launching PM/TL bots from a source checkout.
---

# Battuta setup

Set up a source checkout for local development. Paths below are relative to the repository root; run commands there.

## Source checkout

1. Read [local development](references/development.md) and the shared [stack details](../../../docs/tech-stack.md). Check installed tools against the version files before installing dependencies.
2. Use the development guide's **Contributor tooling** section for contributor dependencies, or **Bot configuration** and **Run** sections to launch bots. Installing checks does not configure bots. The shared [command reference](../../../docs/commands.md) maps tooling entry points.
3. Confirm whether the backend is local or remote; use the corresponding environment template and launch target. Keep credentials private and ask the owner to complete provider login interactively.
4. Verify both bots respond to the allowed Telegram user. Inspect failures before reporting setup complete; avoid duplicate bot processes.

## Contributor skills

Project skills are discovered under `.agents/skills/`. The root `opencode.json` installs [Superpowers](https://github.com/obra/superpowers) through OpenCode's plugin manager; see [OpenCode setup](../../../docs/opencode.md) to install, verify, or update it.
