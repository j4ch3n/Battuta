"""Keep direct Stone resources disabled; the shared bridge owns memory."""

from pathlib import Path

import click

from .json_config import read_config, write_config


def configure_memory_settings(bot_dir: Path) -> None:
    path = bot_dir / ".pi" / "settings.json"
    settings = read_config(path)
    packages = settings.get("packages", [])
    if not isinstance(packages, list):
        raise click.ClickException("packages must be a JSON array")
    retained = []
    for package in packages:
        source = package.get("source") if isinstance(package, dict) else package
        if isinstance(source, str) and source.split("@", 1)[0] == "npm:pi-memory-stone":
            continue
        retained.append(package)
    changed = retained != packages
    if changed:
        settings["packages"] = retained
    if bot_dir.name in {"pm-bot", "tl-bot"}:
        memory = settings.get("battutaMemory", {})
        if not isinstance(memory, dict):
            raise click.ClickException("battutaMemory must be a JSON object")
        enabled = bot_dir.name == "pm-bot"
        if memory.get("ownerProfile") is not enabled:
            settings["battutaMemory"] = {**memory, "ownerProfile": enabled}
            changed = True
    if changed:
        write_config(path, settings, ".settings-")
