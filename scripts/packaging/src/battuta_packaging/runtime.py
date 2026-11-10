"""Install release-declared JavaScript dependencies, never on bot startup."""

import os
from pathlib import Path
import shutil
import subprocess

import click
from bot_setup.json_config import read_config

from .bundle import PROFILES, SHARED, validate_bundle, write_json


def check_node(root: Path, node: Path) -> dict:
    metadata = validate_bundle(root)
    try:
        actual = subprocess.run([str(node), "--version"], check=True, capture_output=True, text=True).stdout.strip().removeprefix("v")
    except (OSError, subprocess.CalledProcessError) as error:
        raise click.ClickException("Cannot execute the selected Node") from error
    if actual != metadata["node"]:
        raise click.ClickException(f"Node must match release version {metadata['node']}")
    return metadata


def install_runtime(root: Path, *, node: Path) -> None:
    node = node.resolve()
    metadata = check_node(root, node)
    (root / "bots/runtime.json").unlink(missing_ok=True)
    env = {**os.environ, "PATH": str(node.parent) + os.pathsep + os.environ.get("PATH", "")}
    pnpm = shutil.which("pnpm", path=env["PATH"])
    if not pnpm:
        raise click.ClickException("Install the release-declared pnpm version first")
    actual = subprocess.run([pnpm, "--version"], check=True, capture_output=True, text=True, env=env).stdout.strip()
    if "pnpm@" + actual != metadata["packageManager"]:
        raise click.ClickException("pnpm must match the release metadata")
    directories = [root / "bots/_shared" / name for name in SHARED] + [root / "bots" / profile for profile in PROFILES]
    for directory in directories:
        subprocess.run([pnpm, "install", "--prod", "--frozen-lockfile"], cwd=directory, env=env, check=True)
    for profile in PROFILES:
        bot = root / "bots" / profile
        local_env = {**env, "PI_CODING_AGENT_DIR": str(bot / ".pi")}
        for package in metadata["packages"][profile]:
            subprocess.run([pnpm, "exec", "pi", "install", "-l", "--approve", package], cwd=bot, env=local_env, check=True)
        if profile == "manager-bot":
            settings = read_config(bot / ".pi/settings.json")
            settings.setdefault("subagents", {})["defaultExtensions"] = [str(bot / ".pi/npm/node_modules/pi-web-access/dist")]
            write_json(bot / ".pi/settings.json", settings)
    write_json(root / "bots/runtime.json", {"node": str(node)})


def check_packages(root: Path, profile: Path, metadata: dict) -> None:
    if not (root / "bots/runtime.json").is_file():
        raise click.ClickException("Run install-runtime before launching bots")
    for source in metadata["packages"][profile.name]:
        name, version = source.removeprefix("npm:").rsplit("@", 1)
        package = read_config(profile / ".pi/npm/node_modules" / name / "package.json")
        if package.get("name") != name or package.get("version") != version:
            raise click.ClickException(f"Run install-runtime to restore {source} before launching bots")
