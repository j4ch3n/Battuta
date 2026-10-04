"""Install pinned Pi packages and report live sessions."""

import os
from pathlib import Path
import shutil
import subprocess

import click


TELEGRAM_PACKAGE = "npm:@llblab/pi-telegram@0.50.1"
SCHEDULE_PACKAGE = "npm:pi-schedule-prompt@0.4.1"
MEMORY_PACKAGE = "npm:pi-memory-stone@0.1.7"


def run(*args: str, **kwargs: object) -> None:
    try:
        subprocess.run(args, check=True, **kwargs)
    except subprocess.CalledProcessError as error:
        raise click.ClickException(f"{args[0]} failed (exit {error.returncode})") from error


def install_packages(bot_dir: Path, telegram_package: str, *, extra_packages: tuple[str, ...] = ()) -> None:
    if shutil.which("pnpm") is None:
        raise click.ClickException("pnpm is required")
    run("pnpm", "install", "--frozen-lockfile", cwd=bot_dir)
    agent_env = {**os.environ, "PI_CODING_AGENT_DIR": str(bot_dir / ".pi")}
    for package in (telegram_package, *extra_packages):
        run("pnpm", "exec", "pi", "install", "-l", "--approve", package, cwd=bot_dir, env=agent_env)
    run("pnpm", "exec", "pi", "list", cwd=bot_dir, env=agent_env)


def warn_running_session(bot_dir: Path) -> None:
    session = "battuta-pm-bot"
    if shutil.which("tmux") and subprocess.run(
        ["tmux", "has-session", "-t", f"={session}"], capture_output=True
    ).returncode == 0:
        click.echo(f"The existing {session} session is still running; save queued Telegram messages before restarting it to load updated configuration.")
