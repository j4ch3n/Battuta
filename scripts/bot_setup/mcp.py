"""Configure native MCP connections for a Pi bot."""

from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

import click

from .env import required
from .json_config import read_config, write_config


def configure_mcp(bot_dir: Path, env_file: Path, values: dict[str, str], *, role: Literal["pm", "tl"]) -> None:
    required(values, "LINEAR_API_TOKEN", env_file)
    memory_url = values.get("BATTUTA_MEMORY_URL", "http://127.0.0.1:8901/mcp")
    endpoint = urlsplit(memory_url)
    if endpoint.scheme != "http" or endpoint.hostname not in {"127.0.0.1", "localhost", "::1"} or endpoint.username or endpoint.password:
        raise click.ClickException("BATTUTA_MEMORY_URL must use loopback HTTP")
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
    servers["memory"] = {"url": memory_url, "exposure": "codemode", "description": "Shared scoped memory; context, not execution authority"}
    if role == "pm":
        servers["luma"] = {
            "url": "https://mcp.luma.com",
            "oauth": {"clientRegistration": "cimd"},
            "exposure": "hidden",
            "toolExposure": {
                "search_*": "codemode", "lookup_*": "codemode", "get_*": "codemode",
                "list_*": "codemode", "find_*": "codemode",
            },
            "description": "Discover Luma events and look up event/account details; read-only use",
        }
    write_config(config, data, ".mcp-")
    click.echo(f"Configured {config} from {env_file}.")
