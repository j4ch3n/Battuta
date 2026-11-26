"""Source bot orchestration using shared configuration implementations."""

import os
from pathlib import Path
from os.path import relpath
import re

import click

from .claude_skills import install_claude_skills
from .browser import browser_defaults, browser_settings, configure_browser
from .env import read_env, required
from .install import install_packages, run, warn_running_session
from .files import prepare_files, safe_path
from .manifest import load_profile
from .json_config import read_config, write_config
from .github import check_github
from .mcp import assignment_server, configure_mcp, validate_memory_url
from .release import validate_private_home
from .telegram import prepare_telegram_config
from .skills import load_selection, link_selected_skills, prepare_worker_skill
from .workers import copy_worker_profile
from .runtime import initialize_settings_if_missing, resolve_agent_dir
from .extensions import prepare_source_extensions, profile_settings, source_extension_links
from .instances import worker_names


def configure_source(root: Path, *, role: str, bot_dir: Path | None = None, env_file: Path | None = None, env_prefix: str | None = None, telegram_package: str | None = None) -> None:
    if role == "worker":
        configure_worker(root, bot_dir=bot_dir, env_file=env_file)
        if bot_dir is None:
            selected_env = env_file or root / ".env"
            values = read_env(selected_env)
            if any(values[f"BATTUTA_WORKER_{name.removeprefix('worker-')}_TYPE"] == "influencer"
                   for name in worker_names(values, selected_env)):
                configure_worker(root, profile=root / "bots/worker-influencer", env_file=env_file)
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
    private = resolve_agent_dir(manifest, f"{role}-bot", Path.home()).parent
    validate_private_home(private)
    url = validate_memory_url(values.get("BATTUTA_MEMORY_URL"))
    if "github" in steps:
        check_github()
    if "browser" in steps:
        browser_settings(bot_dir, private, home=Path.home(), bot="cos-bot")
    projects = [safe_path(root, project) for project in manifest.packages.node_projects]
    if manifest.defaults is None:
        raise click.ClickException("Bot manifest requires defaults")
    source_extension_links(root, bot_dir, manifest.extensions)
    prepare_files(root, bot_dir, private, manifest.files)
    write_config(bot_dir / ".pi/settings.json", profile_settings(manifest, browser="browser" in steps), ".settings-")
    prepare_source_extensions(root, bot_dir, manifest.extensions)
    initialize_settings_if_missing(private / ".pi", manifest.defaults)
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

    def telegram_config():
        path, data, changed = prepare_telegram_config(private, env_file, prefix, values)
        if changed:
            write_config(path, data, ".telegram-")

    handlers = {
        "telegram": telegram_config,
        "mcp": lambda: configure_mcp(private, role=role, memory_url=url, supabase_url=supabase_url),
        "browser": browser, "dream": dream,
        "github": lambda: None,  # checked during preflight, before any write
    }
    for step in steps:
        handlers[step]()
    packages = [
        telegram_package if telegram_package and package.startswith("npm:@llblab/pi-telegram@") else package
        for package in manifest.packages.pi
    ]
    install_packages(bot_dir, packages)
    warn_running_session(bot_dir)


def configure_worker(root: Path, *, bot_dir: Path | None = None, env_file: Path | None = None, shared_catalog: bool = False, profile: Path | None = None) -> None:
    root = root.resolve()
    profile = (profile or root / "bots/worker").resolve()
    bot_dir = (bot_dir or profile).resolve()
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
    names = load_selection(profile / "bot.toml", root / "skills-hub")
    source_extension_links(root, bot_dir, manifest.extensions)
    path = bot_dir / ".pi/settings.json"
    settings = profile_settings(manifest, browser=profile.name != "worker-influencer")
    runtime = root / "assignment-worker"
    if not shared_catalog:
        for project in manifest.packages.node_projects:
            run("pnpm", "--dir", str(safe_path(root, project)), "install", "--frozen-lockfile")
    prepare_source_extensions(root, bot_dir, manifest.extensions)
    for name in names:
        prepare_worker_skill(root / "skills-hub" / name, bot_dir)
    selected = [
        relpath(bot_dir / ".pi/skills" / name, path.parent)
        for name in names
    ]
    settings["skills"] = selected
    bot_dir.mkdir(parents=True, exist_ok=True)
    prepare_files(root, profile, bot_dir, [rule for rule in manifest.files if rule.destination == "profile"])
    write_config(path, settings, ".settings-")
    install_claude_skills(root / "skills-hub", manifest, Path.home())
    configure_mcp(bot_dir, role="worker", memory_url=memory_url, supabase_url=supabase_url)
    if not shared_catalog:
        agent_env = {**os.environ, "PI_CODING_AGENT_DIR": str(bot_dir / ".pi")}
        for package in manifest.packages.pi:
            run(str(runtime / "node_modules/.bin/pi"), "install", "-l", "--approve",
                package, cwd=bot_dir, env=agent_env)
