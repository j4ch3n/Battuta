"""Configure native MCP connections for a Pi bot."""

from pathlib import Path
import subprocess
from typing import Literal

import click

from .env import required


def configure_mcp(bot_dir: Path, env_file: Path, values: dict[str, str], *, role: Literal["pm", "tl"]) -> None:
    required(values, "LINEAR_API_TOKEN", env_file)
    helper = Path(__file__).resolve().parents[2] / "bot-setup/mcp.mjs"
    args = ["node", str(helper), str(bot_dir), "--role", role]
    if "BATTUTA_MEMORY_URL" in values:
        args.extend(["--memory-url", values["BATTUTA_MEMORY_URL"]])
    try:
        subprocess.run(args, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as error:
        raise click.ClickException(error.stderr.strip() or "MCP configuration failed") from error
    except OSError as error:
        raise click.ClickException(f"Cannot run MCP setup: {error}") from error
    click.echo(f"Configured {bot_dir / '.pi/mcp.json'} from {env_file}.")
