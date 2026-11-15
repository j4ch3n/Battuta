"""Worker selection and the boundary between installed code and private state."""

from pathlib import Path
import fcntl
import os
import re
import json
import shutil
import subprocess

import click
from .manifest import load_manifest
from .runtime import resolve_agent_dir


def worker_names(values: dict[str, str], env_file: Path) -> list[str]:
    numbers = []
    for key, value in values.items():
        if not key.startswith("BATTUTA_WORKER_") or key == "BATTUTA_WORKER_CAPABILITIES":
            continue
        match = re.fullmatch(r"BATTUTA_WORKER_([1-9][0-9]*)_TYPE", key)
        if not match or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", value):
            raise click.ClickException(f"Invalid BATTUTA_WORKER_<N>_TYPE selection in {env_file}")
        numbers.append(int(match[1]))
    return [f"worker-{number}" for number in sorted(numbers)]


def worker_environment(root: Path, values: dict[str, str], env_file: Path, bot: str) -> dict[str, str]:
    if bot not in worker_names(values, env_file):
        raise click.ClickException("Worker is not selected by BATTUTA_WORKER_<N>_TYPE")
    kind = values[f"BATTUTA_WORKER_{bot.removeprefix('worker-')}_TYPE"]
    profile = root / "bots" / ("worker-influencer" if kind == "influencer" else "worker")
    manifest = load_manifest(profile / "bot.toml")
    worker = manifest.worker
    if worker is None:
        raise click.ClickException("Worker manifest requires capability types")
    if kind not in worker.types:
        raise click.ClickException(f"Unknown configured worker type for {bot}")
    source = root / "supabase/functions/assignments/abilities.json"
    catalog_path = source if source.exists() else profile / "abilities.json"
    try:
        catalog = json.loads(catalog_path.read_text())
        if not isinstance(catalog, dict):
            raise ValueError("Expected capability catalog")
    except (OSError, ValueError) as error:
        raise click.ClickException("Cannot read the worker capability catalog") from error
    for capabilities in [worker.capabilities, *(entry.capabilities for entry in worker.types.values())]:
        unknown = set(capabilities) - catalog.keys()
        if unknown:
            raise click.ClickException("Unknown worker capabilities in bot.toml; use canonical catalog names")
    capabilities = sorted(set(worker.capabilities) | set(worker.types[kind].capabilities))
    return {"BATTUTA_WORKER_CAPABILITIES": json.dumps(capabilities)}


def validate_mobile_device(env: dict[str, str]) -> None:
    adb = shutil.which("adb", path=env.get("PATH"))
    if not adb:
        raise click.ClickException("Influencer worker requires ADB and an authorized Android device")
    try:
        result = subprocess.run([adb, "get-state"], env=env, capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise click.ClickException("Cannot check Android device readiness") from error
    if result.returncode != 0 or result.stdout.strip() != "device":
        raise click.ClickException("Select one authorized Android device before starting the influencer worker")


def profile_identity(bot: str) -> tuple[str, str]:
    if bot in {"cos-bot", "manager-bot"}:
        role = bot.removesuffix("-bot")
        profile = bot
    elif re.fullmatch(r"worker-[1-9][0-9]*", bot):
        role, profile = "worker", "worker"
    else:
        raise click.ClickException("Bot must be cos-bot, manager-bot, or worker-N (N >= 1)")
    return role, profile


def instance_paths(root: Path, home: Path, bot: str, values: dict[str, str] | None = None) -> tuple[str, Path, Path]:
    role, name = profile_identity(bot)
    if role == "worker" and values and values.get(f"BATTUTA_WORKER_{bot.removeprefix('worker-')}_TYPE") == "influencer":
        name = "worker-influencer"
    profile = root / "bots" / name
    manifest = load_manifest(profile / "bot.toml")
    return role, profile, resolve_agent_dir(manifest, bot, home).parent


def acquire_instance_lock(bot_home: Path) -> int:
    pi = bot_home / ".pi"
    for path in (bot_home.parent.parent, bot_home.parent, bot_home, pi):
        if path.is_symlink() or (path.exists() and not path.is_dir()):
            raise click.ClickException(f"Expected a private directory: {path}")
    pi.mkdir(parents=True, mode=0o700, exist_ok=True)
    try:
        fd = os.open(pi / "instance.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            os.set_inheritable(fd, True)
            return fd
        except OSError:
            os.close(fd)
            raise
    except OSError as error:
        raise click.ClickException(f"Instance is running or its lock is unsafe: {bot_home}") from error
