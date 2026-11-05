"""Register native subagents; execution and authentication belong to Pi."""

from pathlib import Path
import re

import click


SUBAGENT_PACKAGE = "npm:pi-subagents@0.82.1"
WEB_PACKAGE = "npm:pi-web-access@0.43.0"
PROFILES = ("scout", "worker", "reviewer", "researcher", "evidence-auditor", "oracle", "delegate")


def configure_subagents(settings: dict, bot_dir: Path) -> None:
    packages = settings.get("packages", [])
    extensions = settings.get("extensions", [])
    subagents = settings.get("subagents", {})
    if not isinstance(packages, list) or not isinstance(extensions, list) or not isinstance(subagents, dict):
        raise click.ClickException("Invalid Pi packages, extensions or subagents settings")
    overrides = subagents.get("agentOverrides", {})
    if not isinstance(overrides, dict) or any(name in overrides and not isinstance(overrides[name], dict) for name in PROFILES):
        raise click.ClickException("Invalid subagents.agentOverrides")
    packages = list(packages)
    for index, entry in enumerate(packages):
        source = entry.get("source") if isinstance(entry, dict) else entry
        if isinstance(source, str) and re.match(r"^npm:pi-subagents(?:@|$)", source):
            packages[index] = {**entry, "source": SUBAGENT_PACKAGE} if isinstance(entry, dict) else SUBAGENT_PACKAGE
            break
    else:
        packages.append(SUBAGENT_PACKAGE)
    settings["packages"] = packages
    if "extensions" in settings:
        settings["extensions"] = [entry for entry in extensions if not (isinstance(entry, str) and entry.replace("\\", "/").endswith("/bounded-subagents/index.ts"))]
    subagents = dict(subagents)
    if subagents.get("defaultExtensions") is None:
        subagents["defaultExtensions"] = [str(bot_dir.resolve() / ".pi/npm/node_modules/pi-web-access/dist")]
    overrides = dict(overrides)
    for name in PROFILES:
        overrides[name] = {"inheritProjectContext": False, "inheritGlobalContext": False, "inheritSkills": False, "skills": [], "defaultContext": "fresh", "tools": ["read", "grep", "find", "ls", *(["bash", "edit", "write"] if name in {"worker", "delegate"} else []), "web_search", "fetch_content", "get_search_content", "source_check"], **overrides.get(name, {})}
    subagents["agentOverrides"] = overrides
    settings["subagents"] = subagents
