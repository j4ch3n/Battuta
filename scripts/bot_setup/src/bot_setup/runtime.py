"""Manifest-derived private paths and create-only Pi model preferences."""

import json
from pathlib import Path
import re

import click

from .files import safe_path, write_file
from .json_config import read_config
from .manifest import BotManifest, Defaults

PRIVATE_BASE = Path(".battuta/pi-bots")


def resolve_agent_dir(manifest: BotManifest, instance: str, home: Path) -> Path:
    if manifest.runtime is None or manifest.bot is None:
        raise click.ClickException("Bot manifest requires bot and runtime sections")
    role = manifest.bot.role
    if not (re.fullmatch(r"worker-[1-9][0-9]*", instance) if role == "worker" else instance == f"{role}-bot"):
        raise click.ClickException("Invalid instance for bot profile")
    relative = manifest.runtime.pi_coding_agent_dir
    if ("{instance}" in relative) != (role == "worker"):
        raise click.ClickException("Only worker paths must contain {instance}")
    relative = relative.replace("{instance}", instance)
    if "{" in relative or "}" in relative or Path(relative).name != ".pi" or len(Path(relative).parts) < 2:
        raise click.ClickException("Agent directory must end in .pi and use only {instance} substitution")
    target = safe_path(home / PRIVATE_BASE, relative)
    if target.exists() and not target.is_dir():
        raise click.ClickException(f"Expected a private agent directory: {target}")
    return target


def initialize_settings_if_missing(agent_dir: Path, defaults: Defaults, *, initial_settings: dict | None = None) -> None:
    path = safe_path(agent_dir, "settings.json")
    if path.exists():
        if not path.is_file():
            raise click.ClickException(f"Expected private regular settings: {path}")
        read_config(path)
        return
    content = json.dumps({
        **(initial_settings or {}),
        "defaultProvider": defaults.provider,
        "defaultModel": defaults.model,
        "defaultThinkingLevel": defaults.thinking,
    }, indent=2) + "\n"
    if not write_file(path, content.encode(), policy="create-only"):
        read_config(path)
