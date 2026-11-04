"""Configure native MCP connections without touching OAuth grants."""

from pathlib import Path
from ipaddress import ip_address
import re
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


def assignment_server(supabase_url: str) -> dict:
    try:
        endpoint = urlsplit(supabase_url)
        valid = bool(endpoint.hostname) and (endpoint.scheme == "https" or endpoint.scheme == "http" and endpoint.hostname in {"127.0.0.1", "localhost", "::1"})
        valid = valid and not endpoint.username and not endpoint.password and not endpoint.query and not endpoint.fragment and endpoint.path in {"", "/"}
        valid = valid and "\\" not in supabase_url and not any(char.isspace() or ord(char) < 32 or ord(char) == 127 for char in supabase_url)
        host = endpoint.hostname or ""
        try:
            ip_address(host)
        except ValueError:
            host = host.encode("idna").decode("ascii").rstrip(".")
            valid = valid and len(host) <= 253 and all(re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?", label) for label in host.split("."))
        endpoint.port
    except (ValueError, UnicodeError):
        valid = False
    if not valid:
        raise click.ClickException("SUPABASE_URL must be an HTTPS origin or loopback HTTP origin without credentials, query, or fragment")
    return {"url": supabase_url.rstrip("/") + "/functions/v1/assignments", "headers": {"apikey": "${SUPABASE_SECRET_KEY}"}, "exposure": "codemode", "description": "Shared project assignments, ordered TODOs, and local note paths"}


def configure_assignment_mcp(bot_dir: Path, *, supabase_url: str) -> None:
    server = assignment_server(supabase_url)
    path = bot_dir / ".pi/mcp.json"
    config = read_config(path)
    servers = config.get("mcpServers", {})
    if not isinstance(servers, dict):
        raise click.ClickException("mcpServers must be a JSON object")
    servers["assignments"] = server
    config["mcpServers"] = servers
    write_config(path, config, ".mcp-")


def configure_mcp(bot_dir: Path, *, role: Literal["cos", "manager"], supabase_url: str, memory_url: str | None = None) -> None:
    if role not in {"cos", "manager"}:
        raise click.ClickException("Bot role must be cos or manager")
    url = validate_memory_url(memory_url)
    assignment = assignment_server(supabase_url)
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
    servers["assignments"] = assignment
    if role == "cos":
        servers["luma"] = {"url": "https://mcp.luma.com", "oauth": {"clientRegistration": "cimd"}, "exposure": "hidden", "toolExposure": {f"{verb}_*": "codemode" for verb in ("search", "lookup", "get", "list", "find")}, "description": "Discover Luma events and look up event/account details; read-only use"}
    config["mcpServers"] = servers
    if retained != packages:
        settings["packages"] = retained
        write_config(settings_path, settings, ".settings-")
    write_config(path, config, ".mcp-")
