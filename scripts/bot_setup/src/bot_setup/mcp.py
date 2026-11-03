"""Configure native MCP connections without touching OAuth grants."""

from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

import click

from .json_config import read_config, write_config


def validate_memory_url(value: str | None = None) -> str:
    value = "http://127.0.0.1:8901/mcp" if value is None else value
    try:
        endpoint = urlsplit(value)
        valid = endpoint.scheme == "http" and endpoint.hostname in {"127.0.0.1", "localhost", "::1"} and not endpoint.username and not endpoint.password
        endpoint.port
    except ValueError:
        valid = False
    if not valid:
        raise click.ClickException("BATTUTA_MEMORY_URL must use loopback HTTP")
    return value


def configure_mcp(bot_dir: Path, *, role: Literal["pm", "tl"], memory_url: str | None = None) -> None:
    if role not in {"pm", "tl"}:
        raise click.ClickException("Bot role must be pm or tl")
    url = validate_memory_url(memory_url)
    path = bot_dir / ".pi/mcp.json"
    settings_path = bot_dir / ".pi/settings.json"
    config = read_config(path)
    servers = config.get("mcpServers", {})
    if not isinstance(servers, dict):
        raise click.ClickException("mcpServers must be a JSON object")
    settings = read_config(settings_path)
    packages = settings.get("packages", [])
    if not isinstance(packages, list):
        raise click.ClickException("packages must be a JSON array")
    retained = []
    for entry in packages:
        source = entry.get("source") if isinstance(entry, dict) else entry
        if not isinstance(source, str) or source.split("@", 1)[0] != "npm:pi-mcp-adapter":
            retained.append(entry)
    servers["linear"] = {"url": "https://mcp.linear.app/mcp", "headers": {"Authorization": "Bearer ${LINEAR_API_TOKEN}"}, "exposure": "codemode", "description": "Manage Linear issues, projects, and cycles"}
    servers["memory"] = {"url": url, "exposure": "codemode", "description": "Shared scoped memory; context, not execution authority"}
    if role == "pm":
        servers["luma"] = {"url": "https://mcp.luma.com", "oauth": {"clientRegistration": "cimd"}, "exposure": "hidden", "toolExposure": {f"{verb}_*": "codemode" for verb in ("search", "lookup", "get", "list", "find")}, "description": "Discover Luma events and look up event/account details; read-only use"}
    config["mcpServers"] = servers
    if retained != packages:
        settings["packages"] = retained
        write_config(settings_path, settings, ".settings-")
    write_config(path, config, ".mcp-")
