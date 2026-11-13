"""Pi package configuration shared by bot setup."""

import re
import hashlib
from pathlib import Path

import click


WEB_PACKAGE = "npm:pi-web-access@0.43.0"
WORKER_SUBAGENT_PACKAGE = "npm:@tintinweb/pi-subagents@0.24.0"


def prepare_worker_agents(source: Path, bot_dir: Path, settings: dict) -> None:
    """Refresh owned definitions without overwriting private customizations."""
    destination = bot_dir / ".pi/agents"
    previous = settings.get("battutaWorkerAgents", {})
    if not isinstance(previous, dict):
        raise click.ClickException("battutaWorkerAgents must be a JSON object")
    if destination.is_symlink() or (destination.exists() and not destination.is_dir()):
        raise click.ClickException(f"Refusing custom subagent directory: {destination}")
    pending = {}
    for name in ("researcher.md", "reviewer.md"):
        content = (source / name).read_bytes()
        target = destination / name
        if target.is_symlink() or (target.exists() and not target.is_file()):
            raise click.ClickException(f"Refusing custom subagent path: {target}")
        if target.exists():
            current = target.read_bytes()
            if current != content and hashlib.sha256(current).hexdigest() != previous.get(name):
                raise click.ClickException(f"Refusing to overwrite custom subagent: {target}")
        pending[name] = content
    destination.mkdir(parents=True, exist_ok=True)
    for name, content in pending.items():
        (destination / name).write_bytes(content)
    settings["battutaWorkerAgents"] = {
        name: hashlib.sha256(content).hexdigest() for name, content in pending.items()
    }

def remove_manager_subagents(settings: dict) -> None:
    packages = settings.get("packages", [])
    if not isinstance(packages, list):
        raise click.ClickException("Invalid Pi packages settings")
    settings["packages"] = [
        entry for entry in packages
        if not (isinstance(source := entry.get("source") if isinstance(entry, dict) else entry, str)
                and re.match(r"^npm:pi-subagents(?:@|$)", source))
    ]
