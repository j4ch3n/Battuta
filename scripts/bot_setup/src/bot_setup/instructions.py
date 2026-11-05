"""Assemble shared and role-specific instructions for a bot workspace."""

from pathlib import Path
from typing import Literal

import click


def configure_instructions(bot_dir: Path, *, role: Literal["cos", "manager"], root: Path | None = None) -> None:
    from .skills import load_selection, link_selected_skills
    if role not in {"cos", "manager"}:
        raise click.ClickException(f"Unknown bot role: {role}")
    root = (root or bot_dir.parent.parent).resolve()
    manifest = bot_dir / "skills.json"
    names = load_selection(manifest if manifest.exists() else root / f"bots/{role}-bot/skills.json", root / "skills-hub")
    write_instructions(bot_dir, root=root)
    link_selected_skills(bot_dir, root / "skills-hub", names)


def write_instructions(bot_dir: Path, *, root: Path | None = None) -> None:
    shared = (root / "bots" if root else bot_dir.parent) / "AGENTS_shared.md"
    dedicated = bot_dir / "AGENTS_dedicated.md"
    for source in (shared, dedicated):
        if not source.is_file():
            raise click.ClickException(f"Missing {source}")
    sources = [shared, dedicated]
    (bot_dir / "AGENTS.md").write_text("\n".join(source.read_text() for source in sources))
