"""Worker selection and the boundary between installed code and private state."""

from pathlib import Path
import fcntl
import os
import re

import click
from .manifest import load_manifest
from .runtime import resolve_agent_dir


def worker_names(values: dict[str, str], env_file: Path) -> list[str]:
    value = values.get("WORKER_BOT_COUNT", "")
    if not re.fullmatch(r"[0-9]+", value):
        raise click.ClickException(f"WORKER_BOT_COUNT must be a non-negative integer in {env_file}")
    try:
        count = int(value)
    except ValueError as error:
        raise click.ClickException(f"Invalid WORKER_BOT_COUNT in {env_file}") from error
    return [f"worker-{number}" for number in range(1, count + 1)]


def profile_identity(bot: str) -> tuple[str, str]:
    if bot in {"cos-bot", "manager-bot"}:
        role = bot.removesuffix("-bot")
        profile = bot
    elif re.fullmatch(r"worker-[1-9][0-9]*", bot):
        role, profile = "worker", "worker"
    else:
        raise click.ClickException("Bot must be cos-bot, manager-bot, or worker-N (N >= 1)")
    return role, profile


def instance_paths(root: Path, home: Path, bot: str) -> tuple[str, Path, Path]:
    role, name = profile_identity(bot)
    profile = root / "bots" / name
    manifest = load_manifest(profile / "bot.toml")
    return role, profile, resolve_agent_dir(manifest, bot, home).parent


def acquire_instance_lock(bot_home: Path) -> int:
    pi = bot_home / ".pi"
    for path in (bot_home.parent.parent, bot_home.parent, bot_home, pi):
        if path.is_symlink() or (path.exists() and not path.is_dir()):
            raise click.ClickException(f"Expected a private directory: {path}")
    pi.mkdir(parents=True, mode=0o700, exist_ok=True)
    try:
        fd = os.open(pi / "instance.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            os.set_inheritable(fd, True)
            return fd
        except OSError:
            os.close(fd)
            raise
    except OSError as error:
        raise click.ClickException(f"Instance is running or its lock is unsafe: {bot_home}") from error
