"""Assemble shared and role-specific instructions for a bot workspace."""

from pathlib import Path

import click


def configure_instructions(bot_dir: Path) -> None:
    shared = bot_dir.parent / "AGENTS_shared.md"
    dedicated = bot_dir / "AGENTS_dedicated.md"
    for source in (shared, dedicated):
        if not source.is_file():
            raise click.ClickException(f"Missing {source}")
    (bot_dir / "AGENTS.md").write_text(
        shared.read_text() + "\n" + dedicated.read_text()
    )
    if bot_dir.name in {"pm-bot", "tech-lead-bot"}:
        from .skills import link_project_context
        link_project_context(bot_dir)
