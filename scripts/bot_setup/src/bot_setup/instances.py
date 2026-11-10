"""Worker selection and the boundary between installed code and private state."""

from pathlib import Path
import re

import click


def worker_names(values: dict[str, str], env_file: Path) -> list[str]:
    value = values.get("WORKER_BOT_COUNT", "")
    if not re.fullmatch(r"[0-9]+", value):
        raise click.ClickException(f"WORKER_BOT_COUNT must be a non-negative integer in {env_file}")
    try:
        count = int(value)
    except ValueError as error:
        raise click.ClickException(f"Invalid WORKER_BOT_COUNT in {env_file}") from error
    return [f"worker-{number}" for number in range(1, count + 1)]


def instance_paths(root: Path, home: Path, bot: str) -> tuple[str, Path, Path]:
    if bot in {"cos-bot", "manager-bot"}:
        role = bot.removesuffix("-bot")
        profile = bot
    elif re.fullmatch(r"worker-[1-9][0-9]*", bot):
        role, profile = "worker", "worker"
    else:
        raise click.ClickException("Bot must be cos-bot, manager-bot, or worker-N (N >= 1)")
    return role, root / "bots" / profile, home / ".battuta/pi-bots" / bot
