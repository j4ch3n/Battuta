"""Pi package configuration shared by bot setup."""

import re

import click


WEB_PACKAGE = "npm:pi-web-access@0.43.0"

def remove_manager_subagents(settings: dict) -> None:
    packages = settings.get("packages", [])
    if not isinstance(packages, list):
        raise click.ClickException("Invalid Pi packages settings")
    settings["packages"] = [
        entry for entry in packages
        if not (isinstance(source := entry.get("source") if isinstance(entry, dict) else entry, str)
                and re.match(r"^npm:pi-subagents(?:@|$)", source))
    ]
