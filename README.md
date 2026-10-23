# Battuta

Battuta brings a team of AI agents together to help plan, build, and review software projects. It connects product conversations with engineering work so ideas can move from requirements to implementation.

## Features

- **Product planning:** A Project Manager bot helps clarify requirements and organize work through Telegram.
- **Technical planning:** A Tech Lead bot turns product goals into an engineering approach and actionable tasks.
- **Agent collaboration:** Bots communicate directly and retain shared project context across sessions.
- **Web research:** Both bots can search the web and retrieve source content for current research.
- **Scheduled work:** The Project Manager can run scoped, persistent scheduled prompts for reminders and recurring work.
- **Shared memory:** Bots retain and retrieve project and owner context through a local memory service.
- **Artifact sharing:** Teams can register and serve approved local project artifacts through a controlled catalog.
- **Implementation and review:** Engineer and review bots are planned to handle code changes and feedback (work in progress).

## Getting started

See [local development](.agents/skills/battuta-setup/references/development.md) for working from source or the [Raspberry Pi release guide](RELEASE.md) for installing a prebuilt release.

## Further guidance

- [Contributor conventions](AGENTS.md) and [OpenCode skills](docs/opencode.md)
- [Tech stack](docs/tech-stack.md) and [command reference](docs/commands.md)
- [Agent mail](agent-mail/README.md) and [Linear issue guidance](docs/linear-issues.md)
- [Shared memory architecture and operations](docs/memory-service.md)
