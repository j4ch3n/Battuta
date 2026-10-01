"""Refresh both Telegram profiles from an explicitly selected environment file."""

from pathlib import Path

import click

from bot_setup.env import read_env
from bot_setup.json_config import write_config
from bot_setup.telegram import prepare_telegram_config

ROOT = Path(__file__).resolve().parents[1]


@click.command()
@click.argument("env_file", type=click.Path(dir_okay=False, path_type=Path))
def main(env_file: Path) -> None:
    values = read_env(env_file)
    # Validate both profiles before changing either file.
    prepared = [
        (role, prepare_telegram_config(ROOT / f"bots/{role}-bot", env_file, role.upper(), values))
        for role in ("pm", "tl")
    ]
    for role, (config, data, changed) in prepared:
        if changed:
            write_config(config, data, ".telegram-")
            click.echo(f"Updated {role} Telegram configuration from {env_file}.")


if __name__ == "__main__":
    main()
