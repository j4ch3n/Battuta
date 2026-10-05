"""Assemble shared and role-specific instructions for a bot workspace."""

from pathlib import Path

import click


def configure_instructions(bot_dir: Path) -> None:
    shared = bot_dir.parent / "AGENTS_shared.md"
    dedicated = bot_dir / "AGENTS_dedicated.md"
    for source in (shared, dedicated):
        if not source.is_file():
            raise click.ClickException(f"Missing {source}")
    sources = [shared, dedicated]
    personal = bot_dir.parent / "AGENTS_personal.md"
    if personal.is_file():
        sources.append(personal)
    (bot_dir / "AGENTS.md").write_text("\n".join(source.read_text() for source in sources))
    if bot_dir.name in {"pm-bot", "tl-bot"}:
        from .skills import link_shared_skills
        link_shared_skills(bot_dir)
