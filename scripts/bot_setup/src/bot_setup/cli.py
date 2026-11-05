"""Installed setup commands with explicit workspace roots."""

from pathlib import Path

import click

from . import skills
from .configure import configure_source, configure_release, configure_worker
from .env import read_env
from .install import TELEGRAM_PACKAGE
from .json_config import write_config
from .telegram import prepare_telegram_config

DIRECTORY = click.Path(exists=True, file_okay=False, path_type=Path, resolve_path=True)
FILE = click.Path(dir_okay=False, path_type=Path, resolve_path=True)


@click.group()
def main():
    """Configure Battuta bots and validate their skill selections."""


@main.command()
@click.option("--root", type=DIRECTORY, required=True)
@click.option("--role", type=click.Choice(["cos", "manager", "worker"]), required=True)
@click.option("--bot-dir", type=click.Path(file_okay=False, path_type=Path, resolve_path=True))
@click.option("--env-file", type=FILE)
@click.option("--env-prefix")
@click.option("--telegram-package", default=TELEGRAM_PACKAGE)
def configure(root, role, bot_dir, env_file, env_prefix, telegram_package):
    """Configure a source-checkout bot."""
    configure_source(root, role=role, bot_dir=bot_dir, env_file=env_file, env_prefix=env_prefix, telegram_package=telegram_package)


@main.command("refresh-telegram")
@click.option("--root", type=DIRECTORY, required=True)
@click.argument("env_file", type=FILE)
def refresh_telegram(root, env_file):
    """Refresh CoS Telegram without reinstalling packages."""
    values = read_env(env_file)
    path, data, changed = prepare_telegram_config(root / "bots/cos-bot", env_file, "COS", values)
    if changed:
        write_config(path, data, ".telegram-")
        click.echo(f"Updated {path} from {env_file}.")


@main.command("configure-release")
@click.option("--root", type=DIRECTORY, required=True)
def release(root):
    """Configure a clean installed release."""
    configure_release(root)


@main.command("configure-worker")
@click.option("--root", type=DIRECTORY, required=True)
@click.option("--bot-dir", type=click.Path(file_okay=False, path_type=Path, resolve_path=True))
@click.option("--env-file", type=FILE)
def worker(root, bot_dir, env_file):
    """Prepare the release worker profile, or copy it to a private instance."""
    configure_worker(root, bot_dir=bot_dir, env_file=env_file or root / ".env.prod", shared_catalog=True)


@main.group("skills")
def skills_cli():
    """Validate manifest selections."""


@skills_cli.command("check")
@click.option("--root", type=DIRECTORY, required=True)
@click.option("--staged", is_flag=True)
def check_skills(root, staged):
    """Check every profile or its Git-index state."""
    skills.check_manifests(root, staged=staged)


if __name__ == "__main__":
    main()
