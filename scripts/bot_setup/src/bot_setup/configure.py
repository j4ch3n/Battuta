"""Source bot orchestration using shared configuration implementations."""

import os
from pathlib import Path
from os.path import relpath
import re

import click

from .browser import browser_defaults, browser_settings, configure_browser
from .env import read_env, required
from .install import install_packages, run, warn_running_session
from .files import prepare_files, safe_path
from .manifest import load_profile
from .instances import instance_paths
from .json_config import read_config, write_config
from .mcp import assignment_server, configure_mcp, validate_memory_url
from .memory import configure_memory_settings
from .release import validate_private_home
from .subagents import prepare_worker_agents, prepare_worker_research, remove_manager_subagents
from .telegram import prepare_telegram_config
from .skills import load_selection, link_selected_skills
from .workers import copy_worker_profile, validate_worker_settings


def configure_source(root: Path, *, role: str, bot_dir: Path | None = None, env_file: Path | None = None, env_prefix: str | None = None, telegram_package: str | None = None) -> None:
    if role == "worker":
        configure_worker(root, bot_dir=bot_dir, env_file=env_file)
        return
    if role not in {"cos", "manager"}:
        raise click.ClickException("Bot role must be cos or manager")
    bot_dir = (bot_dir or root / f"bots/{role}-bot").resolve()
    manifest_path = bot_dir / "bot.toml"
    if not manifest_path.exists():
        manifest_path = root / f"bots/{role}-bot/bot.toml"
    manifest = load_profile(manifest_path, role)
    prefix = env_prefix or manifest.bot.env_prefix
    if not re.fullmatch(r"[A-Z][A-Z0-9_]*", prefix):
        raise click.ClickException("--env-prefix must contain uppercase letters, numbers, and underscores")
    steps = manifest.setup.steps
    names = load_selection(manifest_path, root / "skills-hub")
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
    telegram = prepare_telegram_config(private, env_file, prefix, values) if "telegram" in steps else None
    url = validate_memory_url(values.get("BATTUTA_MEMORY_URL"))
    if "browser" in steps:
        browser_settings(bot_dir, private, home=Path.home(), bot="cos-bot")
    projects = [safe_path(root, project) for project in manifest.packages.node_projects]
    prepare_files(root, bot_dir, private, manifest.files)
    link_selected_skills(bot_dir, root / "skills-hub", names)
    for project in projects:
        run("pnpm", "--dir", str(project), "install", "--frozen-lockfile")

    def browser():
        configure_browser(bot_dir, private, home=Path.home(), bot=f"{role}-bot")
        path = bot_dir / ".pi/settings.json"
        settings = read_config(path)
        browser_defaults(settings)
        write_config(path, settings, ".settings-")

    def dream():
        dream_env = {**os.environ, **values, "PI_CODING_AGENT_DIR": str(private / ".pi")}
        run("node", str(root / "memory-client/configure-dream.mjs"), str(bot_dir), env=dream_env)

    def manager_cleanup():
        path = bot_dir / ".pi/settings.json"
        settings = read_config(path)
        remove_manager_subagents(settings)
        write_config(path, settings, ".settings-")

    def telegram_config():
        path, data, changed = telegram
        if changed:
            write_config(path, data, ".telegram-")

    handlers = {
        "telegram": telegram_config,
        "mcp": lambda: configure_mcp(private, role=role, memory_url=url, supabase_url=supabase_url),
        "memory-settings": lambda: configure_memory_settings(bot_dir, role=role),
        "browser": browser, "dream": dream, "manager-cleanup": manager_cleanup,
    }
    for step in steps:
        handlers[step]()
    packages = [
        telegram_package if telegram_package and package.startswith("npm:@llblab/pi-telegram@") else package
        for package in manifest.packages.pi
    ]
    install_packages(bot_dir, packages)
    warn_running_session(bot_dir)


def configure_worker(root: Path, *, bot_dir: Path | None = None, env_file: Path | None = None, shared_catalog: bool = False) -> None:
    root = root.resolve()
    bot_dir = (bot_dir or root / "bots/worker").resolve()
    profile = root / "bots/worker"
    if bot_dir != profile:
        copy_worker_profile(profile, bot_dir)
        return
    env_file = (env_file or root / ".env").resolve()
    manifest = load_profile(profile / "bot.toml", "worker")
    if "worker-profile" not in manifest.setup.steps:
        return
    values = read_env(env_file)
    supabase_url = required(values, "SUPABASE_URL", env_file)
    required(values, "SUPABASE_SECRET_KEY", env_file)
    assignment_server(supabase_url)
    memory_url = validate_memory_url(values.get("BATTUTA_MEMORY_URL"))
    names = load_selection(root / "bots/worker/bot.toml", root / "skills-hub")
    path = bot_dir / ".pi/settings.json"
    settings = read_config(path)
    validate_worker_settings(settings)
    browser_defaults(settings)
    runtime = profile / "extension/assignment-worker"
    if not shared_catalog:
        for project in manifest.packages.node_projects:
            run("pnpm", "--dir", str(safe_path(root, project)), "install", "--frozen-lockfile")
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
    for package in manifest.packages.pi:
        if package not in packages:
            packages.append(package)
    settings["packages"] = packages
    if "research" in names:
        prepare_worker_research(root / "skills-hub/research", bot_dir, settings)
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
    prepare_files(root, profile, bot_dir, [rule for rule in manifest.files if rule.destination == "profile"])
    write_config(path, settings, ".settings-")
    configure_mcp(bot_dir, role="worker", memory_url=memory_url, supabase_url=supabase_url)
    if not shared_catalog:
        agent_env = {**os.environ, "PI_CODING_AGENT_DIR": str(bot_dir / ".pi")}
        for package in manifest.packages.pi:
            run(str(runtime / "node_modules/.bin/pi"), "install", "-l", "--approve",
                package, cwd=bot_dir, env=agent_env)
