"""Configure the Linear MCP connection for a Pi bot."""

from pathlib import Path

import click

from .env import required
from .json_config import read_config, write_config


def configure_mcp(bot_dir: Path, env_file: Path, values: dict[str, str]) -> None:
    required(values, "LINEAR_API_TOKEN", env_file)
    config = bot_dir / ".pi" / "mcp.json"
    data = read_config(config)
    servers = data.setdefault("mcpServers", {})
    if not isinstance(servers, dict):
        raise click.ClickException("mcpServers must be a JSON object")
    settings_path = bot_dir / ".pi" / "settings.json"
    settings = read_config(settings_path)
    packages = settings.get("packages", [])
    if not isinstance(packages, list):
        raise click.ClickException("packages must be a JSON array")
    # An adapter registering /mcp suppresses Pi's native MCP extension.
    retained = []
    for package in packages:
        source = package.get("source", "") if isinstance(package, dict) else package
        if isinstance(source, str) and source.split("@", 1)[0] == "npm:pi-mcp-adapter":
            continue
        retained.append(package)
    if retained != packages:
        settings["packages"] = retained
        write_config(settings_path, settings, ".settings-")
    servers["linear"] = {
        "url": "https://mcp.linear.app/mcp",
        "headers": {"Authorization": "Bearer ${LINEAR_API_TOKEN}"},
        "exposure": "codemode",
        "description": "Manage Linear issues, projects, and cycles",
    }
    write_config(config, data, ".mcp-")
    click.echo(f"Configured {config} from {env_file}.")
