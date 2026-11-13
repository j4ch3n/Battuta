"""Copy a prepared worker profile without its authentication or runtime state."""

from copy import deepcopy
from pathlib import Path

import click

from .browser import browser_settings, configure_browser
from .json_config import read_config, write_config
from .subagents import prepare_worker_agents


def validate_worker_settings(settings: dict) -> None:
    for key in ("packages", "extensions", "skills"):
        if not isinstance(settings.get(key, []), list):
            raise click.ClickException(f"{key} must be a JSON array")


def copy_worker_profile(profile: Path, bot_dir: Path) -> None:
    for name in ("AGENTS.md", ".pi/settings.json", ".pi/mcp.json"):
        if not (profile / name).is_file():
            raise click.ClickException(f"Prepare the source worker profile first: missing {profile / name}")
    if (bot_dir / ".pi").is_symlink():
        raise click.ClickException("Worker .pi must be a private local directory")
    names = ["settings.json", "mcp.json"]
    if (profile / ".pi/web-search.json").is_file():
        names.append("web-search.json")
    for name in ["AGENTS.md", *[f".pi/{name}" for name in names]]:
        target = bot_dir / name
        if target.is_symlink() or (target.exists() and not target.is_file()):
            raise click.ClickException(f"Refusing to replace custom worker path: {target}")
    instructions = (profile / "AGENTS.md").read_text()
    source = {name: read_config(profile / ".pi" / name) for name in names}
    destination = {name: read_config(bot_dir / ".pi" / name) for name in names}
    validate_worker_settings(source["settings.json"])
    validate_worker_settings(destination["settings.json"])

    def resource(value):
        if isinstance(value, dict) and isinstance(value.get("source"), str):
            return {**value, "source": resource(value["source"])}
        if not isinstance(value, str):
            raise click.ClickException("Worker resource entries must be paths or package sources")
        if value.startswith(("npm:", "git:", "https://", "http://")):
            return value
        target = (profile / ".pi" / Path(value).expanduser()).resolve()
        if not target.exists():
            raise click.ClickException(f"Missing prepared worker resource: {target}")
        return str(target)

    settings = deepcopy(source["settings.json"])
    settings.update(destination["settings.json"])
    previous = destination["settings.json"].get("battutaWorkerResources", {})
    if not isinstance(previous, dict):
        raise click.ClickException("battutaWorkerResources must be a JSON object")
    validate_worker_settings(previous)
    owned = {}
    for key in ("packages", "extensions", "skills"):
        entries = [resource(value) for value in source["settings.json"].get(key, [])]
        owned[key] = entries.copy()
        for value in destination["settings.json"].get(key, []):
            if value not in previous.get(key, []) and value not in entries:
                entries.append(value)
        settings[key] = entries
    settings["battutaWorkerResources"] = owned
    settings["battutaMemoryCapture"] = {"enabled": False}
    settings["pi-browser-use"] = {**source["settings.json"].get("pi-browser-use", {}), **browser_settings(profile, bot_dir, home=Path.home(), bot=bot_dir.name)["pi-browser-use"]}
    mcp = deepcopy(source["mcp.json"])
    source_servers = mcp.get("mcpServers", {})
    destination_servers = destination["mcp.json"].get("mcpServers", {})
    if not isinstance(source_servers, dict) or not isinstance(destination_servers, dict):
        raise click.ClickException("mcpServers must be a JSON object")
    mcp.update(destination["mcp.json"])
    mcp["mcpServers"] = {**destination_servers, **source_servers}
    mcp["mcpServers"]["memory"] = {"enabled": False}
    # Validate every input before creating or changing any instance files.
    prepare_worker_agents(profile / ".pi/agents", bot_dir, settings)
    bot_dir.mkdir(parents=True, exist_ok=True)
    write_config(bot_dir / ".pi/settings.json", settings, ".settings-")
    configure_browser(profile, bot_dir, home=Path.home(), bot=bot_dir.name)
    write_config(bot_dir / ".pi/mcp.json", mcp, ".mcp-")
    if "web-search.json" in names and not (bot_dir / ".pi/web-search.json").exists():
        write_config(bot_dir / ".pi/web-search.json", source["web-search.json"], ".web-")
    if not (bot_dir / "AGENTS.md").exists():
        path = bot_dir / "AGENTS.md"
        path.write_text(instructions)
        path.chmod(0o600)
