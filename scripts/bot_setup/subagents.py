"""Expose the pinned TL adapter in custom workspaces without replacing plugins."""
from pathlib import Path
from shutil import copytree

import click

from .install import run
from .json_config import read_config, write_config


def configure_subagents(bot_dir: Path, *, root: Path) -> None:
    source = root.resolve() / "bots/tl-bot"
    if bot_dir.resolve() == source:
        return  # Tracked extension and skill are discovered in place.
    settings_path = bot_dir / ".pi/settings.json"
    settings = read_config(settings_path)
    extensions = settings.get("extensions", [])
    if not isinstance(extensions, list):
        raise click.ClickException("extensions must be a JSON array")
    extension = str(source / ".pi/extensions/bounded-subagents/index.ts")
    run("pnpm", "install", "--frozen-lockfile", cwd=source)
    if extension not in extensions:
        settings["extensions"] = [*extensions, extension]
        write_config(settings_path, settings, ".settings-")
    target = bot_dir / ".pi/skills/use-subagent"
    if not target.exists() and not target.is_symlink():
        target.parent.mkdir(parents=True, exist_ok=True)
        copytree(source / ".pi/skills/use-subagent", target)
