"""Generate current release-owned configuration outside the installation."""

import os
from pathlib import Path

import click

from .env import read_env, required
from .instances import instance_paths, worker_names
from .install import run
from .json_config import read_config, write_config
from .mcp import mcp_payload, validate_memory_url
from .telegram import telegram_payload


def validate_private_home(bot_home: Path) -> None:
    for path in (bot_home.parent.parent, bot_home.parent, bot_home, bot_home / ".pi"):
        if path.is_symlink() or (path.exists() and not path.is_dir()):
            raise click.ClickException(f"Expected a private local directory: {path}")
    pi = bot_home / ".pi"
    for name in ("settings.json", "mcp.json", "telegram.json", "web-search.json", "auth.json", "models.json"):
        path = pi / name
        if path.is_symlink() or (path.exists() and not path.is_file()):
            raise click.ClickException(f"Expected a private regular file: {path}")
    settings = read_config(pi / "settings.json")
    for key in ("extensions", "packages", "skills", "prompts", "themes"):
        if key in settings and settings[key] not in ([], {}):
            raise click.ClickException(f"Private {key} conflicts with release-owned resources: {pi / 'settings.json'}")
    for name in ("extensions", "skills", "prompts", "themes", "npm"):
        path = pi / name
        if path.is_symlink() or (path.exists() and (not path.is_dir() or any(path.iterdir()))):
            raise click.ClickException(f"Private resources conflict with installed profile: {path}")
    for base in (bot_home, pi):
        for name in ("AGENTS.override.md", "AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"):
            if (base / name).exists() or (base / name).is_symlink():
                raise click.ClickException(f"Unexpected private instructions: {base / name}")


def configure_release(root: Path, *, env_file: Path, home: Path) -> None:
    values = read_env(env_file)
    names = ["cos-bot", "manager-bot", *worker_names(values, env_file)]
    for key in ("LINEAR_API_TOKEN", "SUPABASE_URL", "SUPABASE_SECRET_KEY"):
        required(values, key, env_file)
    url = validate_memory_url(values.get("BATTUTA_MEMORY_URL"))
    telegram = telegram_payload(env_file, "COS", values)
    outputs = []
    for bot in names:
        role, profile, private = instance_paths(root, home, bot)
        if not (profile / "AGENTS.md").is_file() or not (profile / ".pi/settings.json").is_file():
            raise click.ClickException(f"Missing installed role profile: {profile}")
        validate_private_home(private)
        payload = mcp_payload(role=role, supabase_url=values["SUPABASE_URL"], memory_url=url)
        outputs.append((private / ".pi/mcp.json", payload))
        outputs.append((private / ".pi/web-search.json", read_config(profile / ".pi/web-search.json")))
        if role == "cos":
            outputs.append((private / ".pi/telegram.json", telegram))
    helper = root / "bots/_shared/memory-client/dist/configure-scheduler.js"
    if not helper.is_file():
        raise click.ClickException(f"Missing compiled scheduler helper: {helper}")
    # Provision only after every instance has passed preflight; never start a bot.
    run("node", str(helper), "--initialize", env={**os.environ, **values})
    for path, payload in outputs:
        path.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
        write_config(path, payload, ".release-")
    click.echo(f"Configured CoS, Manager and {len(names) - 2} worker(s); no bots started.")
