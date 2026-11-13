"""Copy a prepared worker profile without its authentication or runtime state."""

from copy import deepcopy
from pathlib import Path

import click

from .browser import browser_settings, configure_browser
from .json_config import read_config, write_config
from .subagents import prepare_worker_agents
from .manifest import load_manifest
from .runtime import initialize_settings_if_missing
from .files import prepare_files


def validate_worker_settings(settings: dict) -> None:
    for key in ("packages", "extensions", "skills"):
        if not isinstance(settings.get(key, []), list):
            raise click.ClickException(f"{key} must be a JSON array")


def rebase_resource(value, profile: Path, *, require_exists: bool = True):
    if isinstance(value, dict) and isinstance(value.get("source"), str):
        return {**value, "source": rebase_resource(value["source"], profile, require_exists=require_exists)}
    if not isinstance(value, str):
        raise click.ClickException("Worker resource entries must be paths or package sources")
    if value.startswith(("npm:", "git:", "https://", "http://")):
        return value
    target = (profile / ".pi" / Path(value).expanduser()).resolve()
    if require_exists and not target.exists():
        raise click.ClickException(f"Missing prepared worker resource: {target}")
    return str(target)


def prepare_launch_worker(root: Path, profile: Path, private: Path, *, bot: str) -> None:
    manifest = load_manifest(profile / "bot.toml")
    if manifest.defaults is None:
        raise click.ClickException("Worker manifest requires defaults")
    settings_path = private / ".pi/settings.json"
    fresh = not settings_path.exists()
    settings = read_config(settings_path)
    if fresh:
        settings = read_config(profile / ".pi/settings.json")
        validate_worker_settings(settings)
        for key in ("extensions", "skills", "packages"):
            if key in settings:
                settings[key] = [rebase_resource(value, profile, require_exists=False) for value in settings[key]]
        browser_settings(profile, private, home=Path.home(), bot=bot)
    if not (private / ".pi/mcp.json").exists() and not (profile / ".pi/mcp.json").is_file():
        raise click.ClickException(
            "Missing generated worker MCP configuration. From the source root run:\n"
            "  uv run --project scripts/bot_setup --locked battuta-bot-setup configure --root . --role worker"
        )
    prepare_files(root, profile, private, [rule for rule in manifest.files if rule.destination == "private"])
    initialize_settings_if_missing(private / ".pi", manifest.defaults, initial_settings=settings)
    if fresh:
        configure_browser(profile, private, home=Path.home(), bot=bot)


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

    settings = deepcopy(source["settings.json"])
    settings.update(destination["settings.json"])
    previous = destination["settings.json"].get("battutaWorkerResources", {})
    if not isinstance(previous, dict):
        raise click.ClickException("battutaWorkerResources must be a JSON object")
    validate_worker_settings(previous)
    owned = {}
    for key in ("packages", "extensions", "skills"):
        entries = [rebase_resource(value, profile) for value in source["settings.json"].get(key, [])]
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
    manifest = load_manifest(profile / "bot.toml")
    if manifest.subagents is None:
        raise click.ClickException("Worker manifest requires subagents")
    agents = {Path(agent.path).name: (profile / ".pi/agents" / Path(agent.path).name).read_bytes() for agent in manifest.subagents.agents}
    prepare_worker_agents(agents, bot_dir)
    bot_dir.mkdir(parents=True, exist_ok=True)
    if not (bot_dir / ".pi/settings.json").exists():
        manifest = load_manifest(profile / "bot.toml")
        if manifest.defaults is None:
            raise click.ClickException("Worker manifest requires defaults")
        initialize_settings_if_missing(bot_dir / ".pi", manifest.defaults)
        settings.update(read_config(bot_dir / ".pi/settings.json"))
    write_config(bot_dir / ".pi/settings.json", settings, ".settings-")
    configure_browser(profile, bot_dir, home=Path.home(), bot=bot_dir.name)
    write_config(bot_dir / ".pi/mcp.json", mcp, ".mcp-")
    if "web-search.json" in names and not (bot_dir / ".pi/web-search.json").exists():
        write_config(bot_dir / ".pi/web-search.json", source["web-search.json"], ".web-")
    if not (bot_dir / "AGENTS.md").exists():
        path = bot_dir / "AGENTS.md"
        path.write_text(instructions)
        path.chmod(0o600)
