"""Assemble shared and role-specific instructions for a bot workspace."""

from pathlib import Path
from typing import Literal

import click
from .files import prepare_files
from .manifest import load_manifest


def configure_instructions(bot_dir: Path, *, role: Literal["cos", "manager"], root: Path | None = None) -> None:
    from .skills import load_selection, link_selected_skills
    if role not in {"cos", "manager"}:
        raise click.ClickException(f"Unknown bot role: {role}")
    root = (root or bot_dir.parent.parent).resolve()
    manifest = bot_dir / "bot.toml"
    names = load_selection(manifest if manifest.exists() else root / f"bots/{role}-bot/bot.toml", root / "skills-hub")
    selected = load_manifest(manifest if manifest.exists() else root / f"bots/{role}-bot/bot.toml")
    prepare_files(root, bot_dir, bot_dir, [rule for rule in selected.files if rule.destination == "profile"])
    link_selected_skills(bot_dir, root / "skills-hub", names)


def write_instructions(bot_dir: Path, *, root: Path | None = None) -> None:
    root = root or bot_dir.parent.parent
    manifest = load_manifest(bot_dir / "bot.toml")
    prepare_files(root, bot_dir, bot_dir, [rule for rule in manifest.files if rule.destination == "profile"])
