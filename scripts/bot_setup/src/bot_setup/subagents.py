"""Pi package configuration shared by bot setup."""

import re
import hashlib
from pathlib import Path

import click


WEB_PACKAGE = "npm:pi-web-access@0.43.0"
WORKER_SUBAGENT_PACKAGE = "npm:@tintinweb/pi-subagents@0.24.0"


def prepare_worker_agents(source: Path, bot_dir: Path, settings: dict) -> None:
    """Refresh owned definitions without overwriting private customizations."""
    settings["battutaWorkerAgents"] = _prepare_files(
        source, bot_dir / ".pi/agents", ["researcher.md", "reviewer.md"],
        settings.get("battutaWorkerAgents", {}),
    )


def prepare_worker_research(source: Path, bot_dir: Path, settings: dict) -> None:
    """Native subagent preloading needs real files, not catalog paths or links."""
    names = ["SKILL.md", *[
        str(path.relative_to(source)) for path in sorted(source.rglob("*"))
        if path.is_file() and path != source / "SKILL.md"
    ]]
    settings["battutaWorkerResearch"] = _prepare_files(
        source, bot_dir / ".pi/skills/research", names,
        settings.get("battutaWorkerResearch", {}),
    )


def _prepare_files(source: Path, destination: Path, names: list[str], previous: dict) -> dict:
    if not isinstance(previous, dict):
        raise click.ClickException("Subagent resource ownership must be a JSON object")
    for parent in (destination, *destination.parents):
        if parent.is_symlink() or (parent.exists() and not parent.is_dir()):
            raise click.ClickException(f"Refusing custom subagent directory: {parent}")
    pending = {}
    for name in names:
        content = (source / name).read_bytes()
        target = destination / name
        for parent in target.parents:
            if parent == destination:
                break
            if parent.is_symlink() or (parent.exists() and not parent.is_dir()):
                raise click.ClickException(f"Refusing custom subagent directory: {parent}")
        if target.is_symlink() or (target.exists() and not target.is_file()):
            raise click.ClickException(f"Refusing custom subagent path: {target}")
        if target.exists():
            current = target.read_bytes()
            if current != content and hashlib.sha256(current).hexdigest() != previous.get(name):
                raise click.ClickException(f"Refusing to overwrite custom subagent: {target}")
        pending[name] = content
    destination.mkdir(parents=True, exist_ok=True)
    for name, content in pending.items():
        (destination / name).parent.mkdir(parents=True, exist_ok=True)
        (destination / name).write_bytes(content)
    return {
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
