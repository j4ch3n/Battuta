"""Prepare manifest-selected project-local extensions."""

import os
import re
from pathlib import Path

import click

from .manifest import BotManifest, Extension
from .json_config import read_config, write_config


def profile_settings(manifest: BotManifest, *, browser: bool = False) -> dict:
    if manifest.bot is None:
        raise click.ClickException("Bot identity is required for profile settings")
    settings = {
        "packages": manifest.packages.pi.copy(),
        "battutaMemoryCapture": {"enabled": manifest.bot.role == "cos", "batchMessages": 6},
    }
    if browser:
        from .browser import browser_defaults
        browser_defaults(settings)
    return settings


def source_extension_links(root: Path, bot_dir: Path, entries: list[Extension]) -> dict[str, str]:
    """Validate the complete selection without changing the workspace."""
    root = root.resolve()
    directory = bot_dir / ".pi/extensions"
    record = bot_dir / ".pi/battuta-extensions.json"
    if directory.parent.is_symlink() or (directory.parent.exists() and not directory.parent.is_dir()):
        raise click.ClickException(f"Expected local Pi directory: {directory.parent}")
    if directory.is_symlink() or (directory.exists() and not directory.is_dir()):
        raise click.ClickException(f"Expected local extensions directory: {directory}")
    if record.is_symlink() or (record.exists() and not record.is_file()):
        raise click.ClickException(f"Expected regular extension record: {record}")
    try:
        previous = read_config(record)
        if not isinstance(previous, dict) or any(
            not isinstance(k, str) or not isinstance(v, str) or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*\.(?:ts|js)", k)
            for k, v in previous.items()
        ):
            raise ValueError("Invalid extension record")
        desired = {}
        for entry in entries:
            source = Path(entry.source)
            if source.is_absolute() or ".." in source.parts:
                raise ValueError("Invalid extension source")
            target = (root / source).resolve(strict=True)
            if not target.is_relative_to(root) or not target.is_file():
                raise ValueError("Invalid extension source")
            name = f"{entry.name}{source.suffix}"
            if name in desired:
                raise ValueError("Duplicate extension name")
            desired[name] = os.path.relpath(target, directory)
        for name, target in desired.items():
            path = directory / name
            if path.is_symlink():
                if os.readlink(path) != previous.get(name):
                    raise ValueError(f"Conflicting extension: {path}")
            elif path.exists():
                raise ValueError(f"Conflicting extension: {path}")
        return desired
    except (OSError, ValueError) as error:
        raise click.ClickException(f"Cannot prepare extensions: {error}") from error


def prepare_source_extensions(root: Path, bot_dir: Path, entries: list[Extension]) -> None:
    desired = source_extension_links(root, bot_dir, entries)
    directory = bot_dir / ".pi/extensions"
    record = bot_dir / ".pi/battuta-extensions.json"
    previous = read_config(record)
    try:
        for name, target in previous.items():
            path = directory / name
            if desired.get(name) != target and path.is_symlink() and os.readlink(path) == target:
                path.unlink()
        directory.mkdir(parents=True, exist_ok=True)
        for name, target in desired.items():
            path = directory / name
            if not path.is_symlink():
                path.symlink_to(target)
        write_config(record, desired, ".extensions-")
    except (OSError, ValueError) as error:
        raise click.ClickException(f"Cannot prepare extensions: {error}") from error
