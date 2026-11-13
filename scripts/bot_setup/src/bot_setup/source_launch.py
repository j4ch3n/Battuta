"""Exec the prepared source worker while retaining its instance lock."""

import os
from pathlib import Path
import subprocess

import click

from .browser import validate_browser, configure_browser
from .env import read_env, required
from .instances import acquire_instance_lock, worker_names, instance_paths
from .manifest import load_profile
from .runtime import initialize_settings_if_missing
from .workers import prepare_launch_worker


def run_source_worker(root: Path, *, bot_dir: Path, env_file: Path, node: Path) -> None:
    values = read_env(env_file)
    if bot_dir.name not in worker_names(values, env_file):
        raise click.ClickException("Worker is outside the configured WORKER_BOT_COUNT")
    for key in ("SUPABASE_URL", "SUPABASE_SECRET_KEY"):
        required(values, key, env_file)
    cli = root / "bots/worker/extension/assignment-worker/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"
    if not cli.is_file():
        raise click.ClickException("Prepare the source worker runtime first")
    _, profile, private = instance_paths(root, Path.home(), bot_dir.name)
    if bot_dir.absolute() != private.absolute():
        raise click.ClickException("Worker directory must match bot.toml runtime path")
    acquire_instance_lock(bot_dir)
    prepare_launch_worker(root, profile, bot_dir, bot=bot_dir.name)
    env = {key: value for key, value in {**os.environ, **values}.items() if "TELEGRAM" not in key and not key.startswith("PI_SCHEDULER")}
    env.update(AGENT_ROLE="worker", BATTUTA_BOT_NAME=bot_dir.name, PI_CODING_AGENT_DIR=str(bot_dir / ".pi"))
    env.setdefault("BATTUTA_MEMORY_URL", "http://127.0.0.1:8901/mcp")
    env.update(validate_browser(root / "bots/worker", bot_dir, home=Path.home(), bot=bot_dir.name, path=env.get("PATH")))
    # Project settings must not shadow interpolated private browser settings.
    os.chdir(root / "bots/worker")
    os.execve(str(node), [str(node), str(cli)], env)


def run_source_bot(root: Path, *, bot: str, env_file: Path) -> None:
    role, profile, private = instance_paths(root, Path.home(), bot)
    if role == "worker":
        raise click.ClickException("Use run-worker for worker instances")
    manifest = load_profile(profile / "bot.toml", role)
    if manifest.defaults is None:
        raise click.ClickException("Bot manifest requires defaults")
    values = read_env(env_file)
    for key in ("SUPABASE_URL", "SUPABASE_SECRET_KEY", "LINEAR_API_TOKEN"):
        required(values, key, env_file)
    fresh = not (private / ".pi/settings.json").exists()
    initialize_settings_if_missing(private / ".pi", manifest.defaults)
    if fresh and "browser" in manifest.setup.steps:
        configure_browser(profile, private, home=Path.home(), bot=bot)
    env = {**os.environ, **values, "AGENT_ROLE": role, "BATTUTA_BOT_NAME": bot, "PI_CODING_AGENT_DIR": str(private / ".pi")}
    env.setdefault("BATTUTA_MEMORY_URL", "http://127.0.0.1:8901/mcp")
    extensions = ["agent-mail", "project-spec"]
    if role == "cos":
        env.update(validate_browser(profile, private, home=Path.home(), bot=bot, path=env.get("PATH")))
        scheduler = root / "memory-client/configure-scheduler.mjs"
        for option, key in (("--print-path", "PI_SCHEDULER_STATE_FILE"), ("--print-catchup", "PI_SCHEDULER_CATCHUP_MAX")):
            env[key] = subprocess.check_output(["node", str(scheduler), option], env=env, text=True).strip()
        subprocess.run(["node", str(scheduler), "--check"], env=env, check=True)
        extensions.append("memory-client")
    else:
        env = {key: value for key, value in env.items() if "TELEGRAM" not in key and not key.startswith("PI_SCHEDULER")}
    cli = profile / "node_modules/.bin/pi"
    args = [str(cli), "--approve", "--continue", "--session-dir", str(private / ".pi/mail-sessions")]
    for extension in extensions:
        args.extend(["--extension", str(root / extension / "index.ts")])
    os.umask(0o077)
    os.chdir(profile)
    os.execve(str(cli), args, env)
