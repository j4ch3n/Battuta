"""Generate current release-owned configuration outside the installation."""

import json
import os
from pathlib import Path
import subprocess

import click

from .browser import browser_directories, browser_settings
from .env import read_env, required
from .instances import instance_paths, worker_names
from .install import run
from .json_config import read_config
from .mcp import mcp_payload, validate_memory_url
from .telegram import telegram_payload
from .manifest import load_profile
from .files import prepare_files, write_file
from .runtime import initialize_settings_if_missing


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
    telegram["profiles"]["default"]["botToken"] = "${COS_TELEGRAM_TOKEN}"
    outputs = []
    browsers = {}
    instances = []
    private_paths = set()
    for bot in names:
        role, profile, private = instance_paths(root, home, bot)
        manifest = load_profile(profile / "bot.toml", role)
        if manifest.defaults is None or private in private_paths:
            raise click.ClickException("Missing defaults or overlapping private instance paths")
        private_paths.add(private)
        if not (profile / "AGENTS.md").is_file() or not (profile / ".pi/settings.json").is_file():
            raise click.ClickException(f"Missing installed role profile: {profile}")
        validate_private_home(private)
        instances.append((profile, private, manifest))
        if role != "manager":
            if not (private / ".pi/settings.json").exists():
                browser_settings(profile, private, home=home, bot=bot)
            browsers[private] = (bot, profile)
        payload = mcp_payload(role=role, supabase_url=values["SUPABASE_URL"], memory_url=url)
        outputs.append((private / ".pi/mcp.json", payload))
        read_config(profile / ".pi/web-search.json")
        if role == "cos":
            outputs.append((private / ".pi/telegram.json", telegram))
    helper = root / "bots/_shared/memory-client/dist/configure-scheduler.js"
    if not helper.is_file():
        raise click.ClickException(f"Missing compiled scheduler helper: {helper}")
    dream = helper.with_name("configure-dream.js")
    if not dream.is_file():
        raise click.ClickException(f"Missing compiled dream helper: {dream}")
    # Provision only after every instance has passed preflight; never start a bot.
    results = []
    skipped = []
    for profile, private, manifest in instances:
        path = private / ".pi/settings.json"
        settings = {}
        if private in browsers and not path.exists():
            bot, _ = browsers[private]
            settings = browser_settings(profile, private, home=home, bot=bot)
        created = initialize_settings_if_missing(private / ".pi", manifest.defaults, initial_settings=settings)
        results.append((path, created))
        if private in browsers and created:
            for directory in browser_directories(home, bot, private):
                directory.mkdir(parents=True, mode=0o700, exist_ok=True)
                directory.chmod(0o700)
        elif private in browsers:
            skipped.append(f"Browser setup skipped for {path}; review browser configuration before launch.")
        results.extend(prepare_files(root, profile, private, [rule.model_copy(update={"policy": "create-only"}) for rule in manifest.files if rule.destination == "private"], context="release"))
    cos_private = instance_paths(root, home, "cos-bot")[2]
    dream_env = {**os.environ, **values, "HOME": str(home), "PI_CODING_AGENT_DIR": str(cos_private / ".pi")}
    dream_result = run("node", str(dream), str(root / "bots/cos-bot"), "--release", env=dream_env, stdout=subprocess.PIPE, text=True)
    if dream_result is not None:
        results.extend((Path(item["path"]), item["created"]) for item in json.loads(dream_result.stdout))
    for path, payload in outputs:
        path.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
        content = (json.dumps(payload, indent=2, allow_nan=False) + "\n").encode()
        results.append((path, write_file(path, content, policy="create-only")))
    click.echo(f"Configured CoS, Manager and {len(names) - 2} worker(s); no bots started.")
    for path, created in results:
        click.echo(f"{'Created' if created else 'Untouched (setup skipped)'}: {path}")
    for message in skipped:
        click.echo(message)
    if any(not created for _, created in results):
        click.echo("Review untouched configuration and skipped setup before starting services.")
