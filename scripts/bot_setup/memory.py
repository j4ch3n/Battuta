"""Configure new capture defaults and remove retired owned runtime entries."""

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
    original = dict(settings)
    if retained != packages:
        settings["packages"] = retained
    settings.pop("battutaMemory", None)
    extensions = settings.get("extensions", [])
    if not isinstance(extensions, list):
        raise click.ClickException("extensions must be a JSON array")
    cleaned = [e for e in extensions if not (isinstance(e, str) and e.replace("\\", "/").endswith("memory-stone/index.ts"))]
    if cleaned != extensions:
        settings["extensions"] = cleaned
    capture = settings.get("battutaMemoryCapture", {})
    if not isinstance(capture, dict) or set(capture) - {"enabled", "batchMessages"} or not isinstance(capture.get("enabled", True), bool) or type(capture.get("batchMessages", 6)) is not int or not 1 <= capture.get("batchMessages", 6) <= 100:
        raise click.ClickException("Invalid battutaMemoryCapture settings")
    settings["battutaMemoryCapture"] = {"enabled": True, "batchMessages": 6, **capture}
    if settings != original:
        write_config(path, settings, ".settings-")
