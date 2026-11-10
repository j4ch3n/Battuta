"""Source bot orchestration using shared configuration implementations."""

import os
from pathlib import Path
from os.path import relpath
import re

import click

from .env import read_env, required
from .install import SCHEDULE_PACKAGE, TELEGRAM_PACKAGE, install_packages, run, warn_running_session
from .instructions import configure_instructions, write_instructions
from .json_config import read_config, write_config
from .mcp import assignment_server, configure_mcp, validate_memory_url
from .memory import configure_memory_settings
from .subagents import SUBAGENT_PACKAGE, WEB_PACKAGE, configure_subagents
from .telegram import prepare_telegram_config
from .skills import check_manifests
from .skills import load_selection
from .workers import copy_worker_profile, validate_worker_settings


def configure_source(root: Path, *, role: str, bot_dir: Path | None = None, env_file: Path | None = None, env_prefix: str | None = None, telegram_package: str = TELEGRAM_PACKAGE) -> None:
    if role == "worker":
        configure_worker(root, bot_dir=bot_dir, env_file=env_file)
        return
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
    supabase_url = required(values, "SUPABASE_URL", env_file)
    required(values, "SUPABASE_SECRET_KEY", env_file)
    assignment_server(supabase_url)
    telegram = prepare_telegram_config(bot_dir, env_file, prefix, values) if role == "cos" else None
    url = validate_memory_url(values.get("BATTUTA_MEMORY_URL"))
    configure_instructions(bot_dir, role=role, root=root)
    if telegram is not None:
        path, data, changed = telegram
        if changed:
            write_config(path, data, ".telegram-")
    configure_mcp(bot_dir, role=role, memory_url=url, supabase_url=supabase_url)
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


def configure_worker(root: Path, *, bot_dir: Path | None = None, env_file: Path | None = None, shared_catalog: bool = False) -> None:
    root = root.resolve()
    bot_dir = (bot_dir or root / "bots/worker").resolve()
    profile = root / "bots/worker"
    if bot_dir != profile:
        copy_worker_profile(profile, bot_dir)
        return
    env_file = (env_file or root / ".env").resolve()
    values = read_env(env_file)
    supabase_url = required(values, "SUPABASE_URL", env_file)
    required(values, "SUPABASE_SECRET_KEY", env_file)
    assignment_server(supabase_url)
    memory_url = validate_memory_url(values.get("BATTUTA_MEMORY_URL"))
    names = load_selection(root / "bots/worker/skills.json", root / "skills-hub")
    shared = root / "bots/AGENTS_shared.md"
    dedicated = profile / "AGENTS_dedicated.md"
    content = "\n".join(path.read_text() for path in (shared, dedicated))
    path = bot_dir / ".pi/settings.json"
    settings = read_config(path)
    validate_worker_settings(settings)
    runtime = profile / "extension/assignment-worker"
    if not shared_catalog:
        run("pnpm", "--dir", str(runtime), "install", "--frozen-lockfile")
        run("pnpm", "--dir", str(root / "agent-mail"), "install", "--frozen-lockfile")
    extensions = settings.get("extensions", [])
    for extension in [runtime / "index.ts", *[runtime / f"node_modules/@earendil-works/pi-coding-agent/dist/extensions/{name}/index.js" for name in ("mcp", "codemode")]]:
        if not extension.is_file():
            raise click.ClickException(f"Missing worker extension: {extension}")
        value = relpath(extension, path.parent)
        if value not in extensions:
            extensions.append(value)
    settings["extensions"] = extensions
    settings["battutaMemoryCapture"] = {"enabled": False}
    if "research" in names:
        packages = settings.get("packages", [])
        if WEB_PACKAGE not in packages:
            packages.append(WEB_PACKAGE)
        settings["packages"] = packages
    selected = [relpath(root / "skills-hub" / name, path.parent) for name in names]
    settings["skills"] = list(dict.fromkeys([*settings.get("skills", []), *selected]))
    bot_dir.mkdir(parents=True, exist_ok=True)
    (bot_dir / "AGENTS.md").write_text(content)
    write_config(path, settings, ".settings-")
    configure_mcp(bot_dir, role="worker", memory_url=memory_url, supabase_url=supabase_url)


def configure_release(root: Path) -> None:
    values = dict(os.environ)
    env_file = root / ".env.prod"
    for key in ("LINEAR_API_TOKEN", "SUPABASE_URL", "SUPABASE_SECRET_KEY"):
        required(values, key, env_file)
    url = validate_memory_url(values.get("BATTUTA_MEMORY_URL"))
    assignment_server(values["SUPABASE_URL"])
    bots = [(role, root / f"bots/{role}-bot") for role in ("cos", "manager")]
    check_manifests(root)
    telegram = prepare_telegram_config(root / "bots/cos-bot", env_file, "COS", values)
    run("node", str(root / "memory-client/configure-scheduler.mjs"), "--initialize")
    for role, bot in bots:
        write_instructions(bot, root=root)
        configure_mcp(bot, role=role, memory_url=url, supabase_url=values["SUPABASE_URL"])
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
            names = load_selection(bot / "skills.json", root / "skills-hub")
            selected = [relpath(root / "skills-hub" / name, settings_path.parent) for name in names]
            settings["skills"] = list(dict.fromkeys([*settings.get("skills", []), *selected]))
        write_config(settings_path, settings, ".settings-")
    path, data, changed = telegram
    if changed:
        write_config(path, data, ".telegram-")
    click.echo("Configured both bots. Run bin/battuta start-prod-screen.")
