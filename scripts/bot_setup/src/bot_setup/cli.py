"""Installed setup commands with explicit workspace roots."""

from pathlib import Path

import click

from . import skills
from .browser import configure_browser, validate_browser
from .configure import configure_source, configure_worker
from .release import configure_release, validate_private_home
from .env import read_env
from .instances import instance_paths, worker_names
from .source_launch import run_source_worker
from .json_config import write_config
from .telegram import prepare_telegram_config

DIRECTORY = click.Path(exists=True, file_okay=False, path_type=Path, resolve_path=True)
FILE = click.Path(dir_okay=False, path_type=Path, resolve_path=True)


@click.group()
def main():
    """Configure Battuta bots and validate their skill selections."""


@main.command("workers")
@click.option("--env-file", type=FILE, required=True)
def workers(env_file):
    """Print selected worker instance names without launching them."""
    for name in worker_names(read_env(env_file), env_file):
        click.echo(name)


@main.command("env-example")
def env_example():
    """Print the release's credential-free environment template."""
    template = Path(__file__).with_name("env.example")
    if not template.is_file():
        raise click.ClickException("For source configuration, use the checkout's .env.example")
    click.echo(template.read_text(), nl=False)


@main.command("run-worker")
@click.option("--root", type=DIRECTORY, required=True)
@click.option("--bot-dir", type=DIRECTORY, required=True)
@click.option("--env-file", type=FILE, required=True)
@click.option("--node", type=click.Path(exists=True, dir_okay=False, path_type=Path, resolve_path=True), required=True)
def run_worker(root, bot_dir, env_file, node):
    """Run a prepared source worker under its private instance lock."""
    run_source_worker(root, bot_dir=bot_dir, env_file=env_file, node=node)


@main.command("configure-browser")
@click.option("--profile", type=DIRECTORY, required=True)
@click.option("--bot-dir", type=DIRECTORY, required=True)
@click.option("--bot", required=True)
def browser_config(profile, bot_dir, bot):
    """Configure one source bot's private browser settings without launching it."""
    configure_browser(profile, bot_dir, home=Path.home(), bot=bot)


@main.command("browser-executable")
@click.option("--profile", type=DIRECTORY, required=True)
@click.option("--bot-dir", type=DIRECTORY, required=True)
@click.option("--bot", required=True)
def browser_executable(profile, bot_dir, bot):
    """Validate private browser settings and print the launch executable."""
    click.echo(validate_browser(profile, bot_dir, home=Path.home(), bot=bot)["CHROME_PATH"])


@main.command()
@click.option("--root", type=DIRECTORY, required=True)
@click.option("--role", type=click.Choice(["cos", "manager", "worker"]), required=True)
@click.option("--bot-dir", type=click.Path(file_okay=False, path_type=Path, resolve_path=True))
@click.option("--env-file", type=FILE)
@click.option("--env-prefix")
@click.option("--telegram-package", help="Override the CoS Telegram package selected by bot.toml.")
def configure(root, role, bot_dir, env_file, env_prefix, telegram_package):
    """Configure a source-checkout bot."""
    configure_source(root, role=role, bot_dir=bot_dir, env_file=env_file, env_prefix=env_prefix, telegram_package=telegram_package)


@main.command("refresh-telegram")
@click.option("--root", type=DIRECTORY, required=True)
@click.argument("env_file", type=FILE)
def refresh_telegram(root, env_file):
    """Refresh CoS Telegram without reinstalling packages."""
    values = read_env(env_file)
    private = instance_paths(root, Path.home(), "cos-bot")[2]
    validate_private_home(private)
    path, data, changed = prepare_telegram_config(private, env_file, "COS", values)
    if changed:
        write_config(path, data, ".telegram-")
        click.echo(f"Updated {path} from {env_file}.")


@main.command("configure-release")
@click.option("--root", type=DIRECTORY, required=True)
@click.option("--env-file", type=FILE, required=True)
def release(root, env_file):
    """Configure a clean installed release."""
    configure_release(root, env_file=env_file, home=Path.home())


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
