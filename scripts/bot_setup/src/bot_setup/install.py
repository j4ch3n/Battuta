"""Install pinned Pi packages and report live sessions."""

import os
from pathlib import Path
import shutil
import subprocess

import click


TELEGRAM_PACKAGE = "npm:@llblab/pi-telegram@0.59.0"
SCHEDULE_PACKAGE = "npm:@jl1990/pi-scheduler@0.5.1"


def run(*args: str, **kwargs: object) -> None:
    try:
        subprocess.run(args, check=True, **kwargs)
    except subprocess.CalledProcessError as error:
        raise click.ClickException(f"{args[0]} failed (exit {error.returncode})") from error


def install_packages(bot_dir: Path, telegram_package: str | None, *, extra_packages: tuple[str, ...] = ()) -> None:
    if shutil.which("pnpm") is None:
        raise click.ClickException("pnpm is required")
    run("pnpm", "install", "--frozen-lockfile", cwd=bot_dir)
    agent_env = {**os.environ, "PI_CODING_AGENT_DIR": str(bot_dir / ".pi")}
    for package in (telegram_package, *extra_packages):
        if package is not None:
            run("pnpm", "exec", "pi", "install", "-l", "--approve", package, cwd=bot_dir, env=agent_env)
    run("pnpm", "exec", "pi", "list", cwd=bot_dir, env=agent_env)


def warn_running_session(bot_dir: Path) -> None:
    if shutil.which("tmux"):
        for session in ("battuta-dev", "battuta-prod"):
            if subprocess.run(["tmux", "has-session", "-t", f"={session}"], capture_output=True).returncode == 0:
                click.echo(f"The existing {session} session is still running; restart it separately to load updated configuration.")
