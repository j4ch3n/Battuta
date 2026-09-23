"""Configure a bot's Telegram Pi profile."""

from pathlib import Path

import click

from .env import positive_id, required
from .json_config import read_config, write_config


def configure_telegram(bot_dir: Path, env_file: Path, prefix: str, values: dict[str, str]) -> None:
    def field(name: str) -> str:
        return f"{prefix}_TELEGRAM_{name}"

    token = required(values, field("TOKEN"), env_file)
    token_id, separator, token_secret = token.partition(":")
    if not separator or not token_secret:
        raise click.ClickException(f"{field('TOKEN')} must have the format <bot ID>:<secret> in {env_file}")
    bot_id = positive_id(token_id, field("TOKEN") + " bot ID", env_file)
    owner = positive_id(required(values, "TELEGRAM_ALLOWED_USER_ID", env_file), "TELEGRAM_ALLOWED_USER_ID", env_file)
    username = values.get(field("BOT_USERNAME"), "").strip().removeprefix("@")
    if username and (not username.isascii() or not username.replace("_", "").isalnum()):
        raise click.ClickException(f"{field('BOT_USERNAME')} must be a Telegram username in {env_file}")

    config = bot_dir / ".pi" / "telegram.json"
    data = read_config(config)
    profiles = data.setdefault("profiles", {})
    if not isinstance(profiles, dict):
        raise click.ClickException("profiles must be a JSON object")
    default = profiles.setdefault("default", {})
    if not isinstance(default, dict):
        raise click.ClickException("profiles.default must be a JSON object")
    default["botToken"] = token
    default["allowedUserId"] = owner
    if username:
        default["botUsername"] = username
    default["botId"] = bot_id

    write_config(config, data, ".telegram-")
    click.echo(f"Configured {config} from {env_file}.")
