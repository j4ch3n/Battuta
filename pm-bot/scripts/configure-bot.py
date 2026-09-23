"""Set up the PM bot's Pi installation, Telegram profile, and MCP connection."""

import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

import click


BOT_DIR = Path(__file__).resolve().parents[1]
ROOT = BOT_DIR.parent
TELEGRAM_PACKAGE = "npm:@llblab/pi-telegram@0.50.1"
MCP_PACKAGE = "npm:pi-mcp-adapter@2.37.0"


def read_env(path: Path) -> dict[str, str]:
    if not path.is_file():
        raise click.ClickException(f"Missing {path}; create it from .env.example")
    values: dict[str, str] = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        key, separator, value = line.partition("=")
        if separator:
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            values[key.strip()] = value
    return values


def required(values: dict[str, str], name: str, path: Path) -> str:
    value = values.get(name, "").strip()
    if not value or value.startswith("#"):
        raise click.ClickException(f"Set {name} in {path}")
    return value


def positive_id(value: str, name: str, path: Path) -> int:
    if not value.isascii() or not value.isdecimal() or int(value) == 0:
        raise click.ClickException(f"{name} must be a positive integer in {path}")
    return int(value)


def configure_telegram(bot_dir: Path, env_file: Path, prefix: str, values: dict[str, str]) -> None:

    def field(name: str) -> str:
        return f"{prefix}_TELEGRAM_{name}"

    token = required(values, field("TOKEN"), env_file)
    owner = positive_id(required(values, "TELEGRAM_ALLOWED_USER_ID", env_file), "TELEGRAM_ALLOWED_USER_ID", env_file)
    username = values.get(field("BOT_USERNAME"), "").strip().removeprefix("@")
    bot_id = values.get(field("BOT_ID"), "").strip()
    if username and (not username.isascii() or not username.replace("_", "").isalnum()):
        raise click.ClickException(f"{field('BOT_USERNAME')} must be a Telegram username in {env_file}")
    parsed_bot_id = positive_id(bot_id, field("BOT_ID"), env_file) if bot_id else None

    config = bot_dir / ".pi" / "telegram.json"
    try:
        data = json.loads(config.read_text()) if config.exists() else {}
    except (OSError, json.JSONDecodeError) as error:
        raise click.ClickException(f"Cannot read {config}: {error}") from error
    if not isinstance(data, dict):
        raise click.ClickException(f"Expected a JSON object in {config}")
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
    if parsed_bot_id is not None:
        default["botId"] = parsed_bot_id

    config.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".telegram-", dir=config.parent)
    try:
        with os.fdopen(fd, "w") as output:
            json.dump(data, output, indent=2)
            output.write("\n")
        os.chmod(temporary, 0o600)
        os.replace(temporary, config)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    click.echo(f"Configured {config} from {env_file}.")


def configure_mcp(bot_dir: Path, env_file: Path, values: dict[str, str]) -> None:
    required(values, "LINEAR_API_KEY", env_file)
    config = bot_dir / ".pi" / "mcp.json"
    try:
        data = json.loads(config.read_text()) if config.exists() else {}
    except (OSError, json.JSONDecodeError) as error:
        raise click.ClickException(f"Cannot read {config}: {error}") from error
    if not isinstance(data, dict):
        raise click.ClickException(f"Expected a JSON object in {config}")
    servers = data.setdefault("mcpServers", {})
    if not isinstance(servers, dict):
        raise click.ClickException("mcpServers must be a JSON object")
    servers["linear"] = {
        "url": "https://mcp.linear.app/mcp",
        "auth": "bearer",
        "bearerTokenEnv": "LINEAR_API_KEY",
    }

    config.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".mcp-", dir=config.parent)
    try:
        with os.fdopen(fd, "w") as output:
            json.dump(data, output, indent=2)
            output.write("\n")
        os.chmod(temporary, 0o600)
        os.replace(temporary, config)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    click.echo(f"Configured {config} from {env_file}.")


def run(*args: str, **kwargs: object) -> None:
    try:
        subprocess.run(args, check=True, **kwargs)
    except subprocess.CalledProcessError as error:
        raise click.ClickException(f"{args[0]} failed (exit {error.returncode})") from error


@click.command()
@click.option("--bot-dir", type=click.Path(exists=True, file_okay=False, path_type=Path), default=BOT_DIR, show_default=True)
@click.option("--env-file", type=click.Path(dir_okay=False, path_type=Path), default=ROOT / ".env", show_default=True)
@click.option("--env-prefix", default="PM", show_default=True, help="Prefix for bot-specific Telegram environment keys.")
@click.option("--telegram-package", default=TELEGRAM_PACKAGE, show_default=True)
@click.option("--mcp-package", default=MCP_PACKAGE, show_default=True)
def main(bot_dir: Path, env_file: Path, env_prefix: str, telegram_package: str, mcp_package: str) -> None:
    """Configure Telegram and project management MCP for one bot."""
    if shutil.which("pnpm") is None:
        raise click.ClickException("pnpm is required")
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
    run("pnpm", "install", "--frozen-lockfile", cwd=bot_dir)
    agent_env = {**os.environ, "PI_CODING_AGENT_DIR": str(bot_dir / ".pi")}
    run("pnpm", "exec", "pi", "install", "-l", "--approve", telegram_package, cwd=bot_dir, env=agent_env)
    run("pnpm", "exec", "pi", "install", "-l", "--approve", mcp_package, cwd=bot_dir, env=agent_env)
    run("pnpm", "exec", "pi", "list", cwd=bot_dir, env=agent_env)

    session = f"{ROOT.name.lower()}-{bot_dir.name}"
    if shutil.which("tmux") and subprocess.run(
        ["tmux", "has-session", "-t", f"={session}"], capture_output=True
    ).returncode == 0:
        click.echo(f"The existing {session} session is still running; save queued Telegram messages before restarting it to load updated configuration.")


if __name__ == "__main__":
    main()
