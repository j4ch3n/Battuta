"""Configure the Linear MCP connection for a Pi bot."""

from pathlib import Path

import click

from .env import required
from .json_config import read_config, write_config


def configure_mcp(bot_dir: Path, env_file: Path, values: dict[str, str]) -> None:
    required(values, "LINEAR_API_KEY", env_file)
    config = bot_dir / ".pi" / "mcp.json"
    data = read_config(config)
    servers = data.setdefault("mcpServers", {})
    if not isinstance(servers, dict):
        raise click.ClickException("mcpServers must be a JSON object")
    servers["linear"] = {
        "url": "https://mcp.linear.app/mcp",
        "auth": "bearer",
        "bearerTokenEnv": "LINEAR_API_KEY",
    }
    write_config(config, data, ".mcp-")
    click.echo(f"Configured {config} from {env_file}.")
