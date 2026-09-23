"""Install pinned Pi packages and report live sessions."""

import os
from pathlib import Path
import shutil
import subprocess

import click


TELEGRAM_PACKAGE = "npm:@llblab/pi-telegram@0.50.1"
MCP_PACKAGE = "npm:pi-mcp-adapter@2.37.0"


def run(*args: str, **kwargs: object) -> None:
    try:
        subprocess.run(args, check=True, **kwargs)
    except subprocess.CalledProcessError as error:
        raise click.ClickException(f"{args[0]} failed (exit {error.returncode})") from error


def install_packages(bot_dir: Path, telegram_package: str, mcp_package: str) -> None:
    if shutil.which("pnpm") is None:
        raise click.ClickException("pnpm is required")
    run("pnpm", "install", "--frozen-lockfile", cwd=bot_dir)
    agent_env = {**os.environ, "PI_CODING_AGENT_DIR": str(bot_dir / ".pi")}
    run("pnpm", "exec", "pi", "install", "-l", "--approve", telegram_package, cwd=bot_dir, env=agent_env)
    run("pnpm", "exec", "pi", "install", "-l", "--approve", mcp_package, cwd=bot_dir, env=agent_env)
    run("pnpm", "exec", "pi", "list", cwd=bot_dir, env=agent_env)


def warn_running_session(bot_dir: Path) -> None:
    session = f"{bot_dir.parent.name.lower()}-{bot_dir.name}"
    if shutil.which("tmux") and subprocess.run(
        ["tmux", "has-session", "-t", f"={session}"], capture_output=True
    ).returncode == 0:
        click.echo(f"The existing {session} session is still running; save queued Telegram messages before restarting it to load updated configuration.")
