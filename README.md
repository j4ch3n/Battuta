# Battuta

Battuta is a team of AI agents working together on software projects.

## Agents Fleet

### PM bot

Helps organize product work and clarify requirements through Telegram. Available for local development.

### Tech-lead bot

Plans the technical approach and breaks work into engineering tasks.

### Engineer bot (WIP)

Implements tasks and makes code changes.

### Review bot (WIP)

Reviews changes and provides feedback before they are accepted.

## Setup

For the hands-on source development and Raspberry Pi 64-bit release instructions, see [setup.md](setup.md). The published release tarball includes `setup.md` at its root. The guide covers dependencies, credentials, local versus remote Supabase, configuration, and optional systemd services.

The PM and tech lead share the [agent-mail extension](agent-mail/README.md) for durable, direct communication. Keep one Pi process per role and resume each bot's persistent Pi session after restart.

Bot workspaces live in `bots/pm-bot` and `bots/tech-lead-bot`. Setup assembles `AGENTS.md` and links the shared project-context Pi skill from `bots/shared-skills/project-context`; rerun setup to refresh the link.

## Project registry

Project configuration and shared `MEMORY.md` live under `~/.battuta/projects/<name>`. Project-context management is a Pi skill provided from `bots/shared-skills/project-context` and linked into PM and Tech Lead during setup and release packaging. Use the skill for registry and explicit memory operations. Executors do not use the registry or memory; they use their project directory, repository `AGENTS.md`, and local runtime. Memory is not injected automatically.
