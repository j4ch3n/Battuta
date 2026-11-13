"""Configure memory capture defaults."""

from pathlib import Path
from typing import Literal

import click

from .json_config import read_config, write_config


def configure_memory_settings(bot_dir: Path, *, role: Literal["cos", "manager"]) -> None:
    path = bot_dir / ".pi" / "settings.json"
    settings = read_config(path)
    packages = settings.get("packages", [])
    if not isinstance(packages, list):
        raise click.ClickException("packages must be a JSON array")
    original = dict(settings)
    extensions = settings.get("extensions", [])
    if not isinstance(extensions, list):
        raise click.ClickException("extensions must be a JSON array")
    capture = settings.get("battutaMemoryCapture", {})
    if not isinstance(capture, dict) or set(capture) - {"enabled", "batchMessages"} or not isinstance(capture.get("enabled", True), bool) or type(capture.get("batchMessages", 6)) is not int or not 1 <= capture.get("batchMessages", 6) <= 100:
        raise click.ClickException("Invalid battutaMemoryCapture settings")
    settings["battutaMemoryCapture"] = {"enabled": True, "batchMessages": 6, **capture}
    if role == "manager":
        settings["battutaMemoryCapture"]["enabled"] = False
    if settings != original:
        write_config(path, settings, ".settings-")
