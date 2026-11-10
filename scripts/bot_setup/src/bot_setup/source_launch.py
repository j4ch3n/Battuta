"""Exec the prepared source worker while retaining its instance lock."""

import os
from pathlib import Path

import click

from .env import read_env, required
from .instances import acquire_instance_lock


def run_source_worker(root: Path, *, bot_dir: Path, env_file: Path, node: Path) -> None:
    values = read_env(env_file)
    for key in ("SUPABASE_URL", "SUPABASE_SECRET_KEY"):
        required(values, key, env_file)
    cli = root / "bots/worker/extension/assignment-worker/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"
    if not cli.is_file():
        raise click.ClickException("Prepare the source worker runtime first")
    env = {key: value for key, value in {**os.environ, **values}.items() if "TELEGRAM" not in key and not key.startswith("PI_SCHEDULER")}
    env.update(AGENT_ROLE="worker", BATTUTA_BOT_NAME=bot_dir.name, PI_CODING_AGENT_DIR=str(bot_dir / ".pi"))
    env.setdefault("BATTUTA_MEMORY_URL", "http://127.0.0.1:8901/mcp")
    acquire_instance_lock(bot_dir)
    os.chdir(bot_dir)
    os.execve(str(node), [str(node), str(cli)], env)
