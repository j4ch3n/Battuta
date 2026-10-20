"""Assemble shared and role-specific instructions for a bot workspace."""

from pathlib import Path
from typing import Literal

import click


def configure_instructions(bot_dir: Path, *, role: Literal["pm", "tl"], root: Path | None = None) -> None:
    shared = (root / "bots" if root else bot_dir.parent) / "AGENTS_shared.md"
    dedicated = bot_dir / "AGENTS_dedicated.md"
    for source in (shared, dedicated):
        if not source.is_file():
            raise click.ClickException(f"Missing {source}")
    sources = [shared, dedicated]
    (bot_dir / "AGENTS.md").write_text("\n".join(source.read_text() for source in sources))
    from .skills import link_shared_skills
    link_shared_skills(bot_dir, role=role, root=root)
