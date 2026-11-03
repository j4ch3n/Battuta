"""Source bot orchestration using shared configuration implementations."""

import os
from pathlib import Path
import re

import click

from .env import read_env, required
from .install import SCHEDULE_PACKAGE, TELEGRAM_PACKAGE, install_packages, run, warn_running_session
from .instructions import configure_instructions, write_instructions
from .json_config import read_config, write_config
from .mcp import configure_mcp, validate_memory_url
from .memory import configure_memory_settings
from .subagents import SUBAGENT_PACKAGE, WEB_PACKAGE, configure_subagents
from .telegram import prepare_telegram_config
from .skills import check_manifests


def configure_source(root: Path, *, role: str, bot_dir: Path | None = None, env_file: Path | None = None, env_prefix: str | None = None, telegram_package: str = TELEGRAM_PACKAGE) -> None:
    if role not in {"cos", "manager"}:
        raise click.ClickException("Bot role must be cos or manager")
    prefix = env_prefix or role.upper()
    if not re.fullmatch(r"[A-Z][A-Z0-9_]*", prefix):
        raise click.ClickException("--env-prefix must contain uppercase letters, numbers, and underscores")
    bot_dir = (bot_dir or root / f"bots/{role}-bot").resolve()
    env_file = (env_file or root / ".env").resolve()
    if not (bot_dir / "package.json").is_file():
        raise click.ClickException(f"Missing {bot_dir / 'package.json'}")
    values = read_env(env_file)
    required(values, "LINEAR_API_TOKEN", env_file)
    telegram = prepare_telegram_config(bot_dir, env_file, prefix, values) if role == "cos" else None
    url = validate_memory_url(values.get("BATTUTA_MEMORY_URL"))
    configure_instructions(bot_dir, role=role, root=root)
    if telegram is not None:
        path, data, changed = telegram
        if changed:
            write_config(path, data, ".telegram-")
    configure_mcp(bot_dir, role=role, memory_url=url)
    configure_memory_settings(bot_dir, role=role)
    if role == "cos":
        run("pnpm", "--dir", str(root / "memory-client"), "install", "--frozen-lockfile")
        run("node", str(root / "memory-client/configure-scheduler.mjs"), "--initialize", env={**os.environ, **values})
        extra = (SCHEDULE_PACKAGE,)
    else:
        path = bot_dir / ".pi/settings.json"
        settings = read_config(path)
        configure_subagents(settings, bot_dir)
        write_config(path, settings, ".settings-")
        extra = (WEB_PACKAGE, SUBAGENT_PACKAGE)
    install_packages(bot_dir, telegram_package if role == "cos" else None, extra_packages=extra)
    warn_running_session(bot_dir)


def configure_release(root: Path) -> None:
    values = dict(os.environ)
    env_file = root / ".env.prod"
    for key in ("LINEAR_API_TOKEN", "SUPABASE_URL", "SUPABASE_SECRET_KEY"):
        required(values, key, env_file)
    url = validate_memory_url(values.get("BATTUTA_MEMORY_URL"))
    bots = [(role, root / f"bots/{role}-bot") for role in ("cos", "manager")]
    check_manifests(root)
    telegram = prepare_telegram_config(root / "bots/cos-bot", env_file, "COS", values)
    run("node", str(root / "memory-client/configure-scheduler.mjs"), "--initialize")
    for role, bot in bots:
        write_instructions(bot, root=root)
        configure_mcp(bot, role=role, memory_url=url)
        configure_memory_settings(bot, role=role)
        settings_path = bot / ".pi/settings.json"
        settings = read_config(settings_path)
        if role == "cos":
            packages = settings.get("packages", [])
            sources = [entry.get("source") if isinstance(entry, dict) else entry for entry in packages]
            if not any(isinstance(source, str) and re.sub(r"@[^@/]+$", "", source) == re.sub(r"@[^@/]+$", "", SCHEDULE_PACKAGE) for source in sources):
                packages.append(SCHEDULE_PACKAGE)
            settings["packages"] = packages
        else:
            configure_subagents(settings, bot)
        write_config(settings_path, settings, ".settings-")
    path, data, changed = telegram
    if changed:
        write_config(path, data, ".telegram-")
    click.echo("Configured both bots. Run bin/battuta start-prod-screen.")
