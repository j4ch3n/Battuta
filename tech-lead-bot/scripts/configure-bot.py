"""Configure the tech-lead bot."""

import sys
from pathlib import Path
import re

import click

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from bot_setup import (  # noqa: E402
    MCP_PACKAGE, TELEGRAM_PACKAGE, configure_mcp, configure_telegram,
    install_packages, read_env, required, warn_running_session,
)

ROOT = Path(__file__).resolve().parents[2]


@click.command()
@click.option("--bot-dir", type=click.Path(exists=True, file_okay=False, path_type=Path), default=ROOT / "tech-lead-bot", show_default=True)
@click.option("--env-file", type=click.Path(dir_okay=False, path_type=Path), default=ROOT / ".env", show_default=True)
@click.option("--env-prefix", default="TECH_LEAD", show_default=True, help="Prefix for bot-specific Telegram environment keys.")
@click.option("--telegram-package", default=TELEGRAM_PACKAGE, show_default=True)
@click.option("--mcp-package", default=MCP_PACKAGE, show_default=True)
def main(bot_dir: Path, env_file: Path, env_prefix: str, telegram_package: str, mcp_package: str) -> None:
    """Configure Telegram and Linear MCP for the tech-lead bot."""
    if not re.fullmatch(r"[A-Z][A-Z0-9_]*", env_prefix):
        raise click.ClickException("--env-prefix must contain uppercase letters, numbers, and underscores")
    bot_dir = bot_dir.resolve()
    env_file = env_file.resolve()
    if not (bot_dir / "package.json").is_file():
        raise click.ClickException(f"Missing {bot_dir / 'package.json'}")

    values = read_env(env_file)
    required(values, f"{env_prefix}_TELEGRAM_TOKEN", env_file)
    required(values, "TELEGRAM_ALLOWED_USER_ID", env_file)
    required(values, "LINEAR_API_KEY", env_file)
    configure_telegram(bot_dir, env_file, env_prefix, values)
    configure_mcp(bot_dir, env_file, values)
    install_packages(bot_dir, telegram_package, mcp_package)
    warn_running_session(bot_dir)


if __name__ == "__main__":
    main()
