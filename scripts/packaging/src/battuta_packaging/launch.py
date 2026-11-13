"""Run one installed bot with explicit private state and an exec-held lock."""

import os
from pathlib import Path
import subprocess

import click
from bot_setup.browser import validate_browser, configure_browser
from bot_setup.env import read_env, required
from bot_setup.instances import acquire_instance_lock, instance_paths, worker_names
from bot_setup.release import validate_private_home
from bot_setup.manifest import load_profile
from bot_setup.runtime import initialize_settings_if_missing

from .runtime import check_node, check_packages


def service_name(bot: str) -> str:
    if bot.startswith("worker-"):
        return "battuta-worker@" + bot.removeprefix("worker-") + ".service"
    return "battuta-" + bot.removesuffix("-bot") + ".service"


def run_bot(root: Path, *, bot: str, env_file: Path, node: Path, mode: str) -> None:
    if mode not in {"service", "foreground-maintenance"}:
        raise click.ClickException("Choose service or foreground-maintenance mode explicitly")
    role, profile, private = instance_paths(root, Path.home(), bot)
    values = read_env(env_file)
    workers = worker_names(values, env_file)
    if role == "worker" and bot not in workers:
        raise click.ClickException("Worker is outside the configured WORKER_BOT_COUNT")
    if mode == "foreground-maintenance":
        result = subprocess.run(["systemctl", "--user", "show", service_name(bot), "--property=ActiveState", "--value"], capture_output=True, text=True)
        if result.returncode != 0 or result.stdout.strip() not in {"inactive", "failed"}:
            raise click.ClickException("Stop the named service and verify it is inactive before foreground maintenance")
    metadata = check_node(root, node)
    check_packages(root, profile, metadata)
    validate_private_home(private)
    for key in ("SUPABASE_URL", "SUPABASE_SECRET_KEY", *(["LINEAR_API_TOKEN"] if role != "worker" else [])):
        required(values, key, env_file)
    for name in ("mcp.json", *(["telegram.json"] if role == "cos" else [])):
        if not (private / ".pi" / name).is_file():
            raise click.ClickException(f"Configure the private instance first: {private}")
    cli = profile / "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"
    if not cli.is_file():
        raise click.ClickException("Run install-runtime before launching bots")
    for ancestor in profile.parents:
        for name in ("AGENTS.override.md", "AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"):
            if (ancestor / name).exists():
                raise click.ClickException(f"Unexpected ancestor instructions: {ancestor / name}")
    acquire_instance_lock(private)
    manifest = load_profile(profile / "bot.toml", role)
    if manifest.defaults is None:
        raise click.ClickException("Bot manifest requires defaults")
    fresh = not (private / ".pi/settings.json").exists()
    initialize_settings_if_missing(private / ".pi", manifest.defaults)
    if fresh and role != "manager":
        configure_browser(profile, private, home=Path.home(), bot=bot)
    env = {**os.environ, **values, "AGENT_ROLE": role, "BATTUTA_BOT_NAME": bot, "PI_CODING_AGENT_DIR": str(private / ".pi")}
    env["PATH"] = str(node.parent) + os.pathsep + env.get("PATH", "")
    if role != "manager":
        env.update(validate_browser(profile, private, home=Path.home(), bot=bot, path=env["PATH"]))
    env["BATTUTA_MEMORY_URL"] = values.get("BATTUTA_MEMORY_URL", "http://127.0.0.1:8901/mcp")
    if role == "cos":
        helper = root / "bots/_shared/memory-client/dist/configure-scheduler.js"
        for option, key in (("--print-path", "PI_SCHEDULER_STATE_FILE"), ("--print-catchup", "PI_SCHEDULER_CATCHUP_MAX")):
            env[key] = subprocess.check_output([str(node), str(helper), option], env=env, text=True).strip()
        subprocess.run([str(node), str(helper), "--check"], env=env, check=True)
    else:
        env = {key: value for key, value in env.items() if "TELEGRAM" not in key and not key.startswith("PI_SCHEDULER")}
    os.umask(0o077)
    os.chdir(profile)
    # Pi's offline flag prevents startup package installs, not provider requests.
    args = [str(node), str(cli), "--approve", "--offline", "--session-dir", str(private / ".pi" / ("sessions" if role == "worker" else "mail-sessions"))]
    if role != "worker":
        args.append("--continue")
    os.execve(str(node), args, env)
