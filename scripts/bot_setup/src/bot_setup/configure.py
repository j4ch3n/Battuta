"""Source bot orchestration using shared configuration implementations."""

import os
from pathlib import Path
from os.path import relpath
import re

import click

from .browser import browser_defaults, browser_settings, configure_browser
from .env import read_env, required
from .install import SCHEDULE_PACKAGE, TELEGRAM_PACKAGE, install_packages, run, warn_running_session
from .instructions import configure_instructions
from .instances import instance_paths
from .json_config import read_config, write_config
from .mcp import assignment_server, configure_mcp, validate_memory_url
from .memory import configure_memory_settings
from .release import validate_private_home
from .subagents import WEB_PACKAGE, WORKER_SUBAGENT_PACKAGE, prepare_worker_agents, prepare_worker_research, remove_manager_subagents
from .telegram import prepare_telegram_config
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
    private = instance_paths(root, Path.home(), f"{role}-bot")[2]
    validate_private_home(private)
    telegram = prepare_telegram_config(private, env_file, prefix, values) if role == "cos" else None
    url = validate_memory_url(values.get("BATTUTA_MEMORY_URL"))
    if role == "cos":
        browser_settings(bot_dir, private, home=Path.home(), bot="cos-bot")
    configure_instructions(bot_dir, role=role, root=root)
    if telegram is not None:
        path, data, changed = telegram
        if changed:
            write_config(path, data, ".telegram-")
    configure_mcp(private, role=role, memory_url=url, supabase_url=supabase_url)
    configure_memory_settings(bot_dir, role=role)
    if role == "cos":
        configure_browser(bot_dir, private, home=Path.home(), bot="cos-bot")
        path = bot_dir / ".pi/settings.json"
        settings = read_config(path)
        browser_defaults(settings)
        write_config(path, settings, ".settings-")
        run("pnpm", "--dir", str(root / "memory-client"), "install", "--frozen-lockfile")
        dream_env = {**os.environ, **values, "PI_CODING_AGENT_DIR": str(private / ".pi")}
        run("node", str(root / "memory-client/configure-dream.mjs"), str(bot_dir), env=dream_env)
        extra = (SCHEDULE_PACKAGE,)
    else:
        path = bot_dir / ".pi/settings.json"
        settings = read_config(path)
        remove_manager_subagents(settings)
        write_config(path, settings, ".settings-")
        extra = (WEB_PACKAGE,)
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
    browser_defaults(settings)
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
    packages = settings.get("packages", [])
    if WORKER_SUBAGENT_PACKAGE not in packages:
        packages.append(WORKER_SUBAGENT_PACKAGE)
    settings["packages"] = packages
    if "research" in names:
        prepare_worker_research(root / "skills-hub/research", bot_dir, settings)
        packages = settings.get("packages", [])
        if WEB_PACKAGE not in packages:
            packages.append(WEB_PACKAGE)
        settings["packages"] = packages
    selected = [
        relpath(bot_dir / ".pi/skills/research" if name == "research" else root / "skills-hub" / name, path.parent)
        for name in names
    ]
    existing = settings.get("skills", [])
    if "research" in names:
        existing = [value for value in existing if value != relpath(root / "skills-hub/research", path.parent)]
    settings["skills"] = list(dict.fromkeys([*existing, *selected]))
    bot_dir.mkdir(parents=True, exist_ok=True)
    prepare_worker_agents(profile / "agents", bot_dir, settings)
    (bot_dir / "AGENTS.md").write_text(content)
    write_config(path, settings, ".settings-")
    configure_mcp(bot_dir, role="worker", memory_url=memory_url, supabase_url=supabase_url)
    if not shared_catalog:
        agent_env = {**os.environ, "PI_CODING_AGENT_DIR": str(bot_dir / ".pi")}
        for package in (WEB_PACKAGE, WORKER_SUBAGENT_PACKAGE):
            run(str(runtime / "node_modules/.bin/pi"), "install", "-l", "--approve",
                package, cwd=bot_dir, env=agent_env)
