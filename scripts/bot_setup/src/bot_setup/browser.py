"""Per-bot browser configuration and launch-time Chromium discovery."""

from pathlib import Path
import shutil
import sys

import click

from .instances import instance_paths
from .json_config import read_config, write_config

BROWSER_PACKAGE = "npm:@amaster.ai/pi-browser-use@0.1.38"
BROWSER_DEFAULTS = {"sessionMode": "persistent", "headless": True, "viewport": "1440x900"}


def browser_directories(home: Path, bot: str) -> tuple[Path, Path]:
    role, _, private = instance_paths(home, home, bot)
    if role == "manager":
        raise click.ClickException("Manager does not use a browser")
    return private / ".pi/browser-research", home / ".battuta/browser-screenshot"


def browser_settings(profile: Path, private: Path, *, home: Path, bot: str) -> dict:
    directory, screenshots = browser_directories(home, bot)
    for base in (directory, screenshots):
        for path in (base, *base.parents):
            if path == home:
                break
            if path.is_symlink() or (path.exists() and not path.is_dir()):
                raise click.ClickException(f"Expected a private local directory: {path}")
    for path in (private, private / ".pi"):
        if path.is_symlink() or (path.exists() and not path.is_dir()):
            raise click.ClickException(f"Expected a private local directory: {path}")
    target = private / ".pi/settings.json"
    if target.is_symlink() or (target.exists() and not target.is_file()):
        raise click.ClickException(f"Expected a private regular file: {target}")
    owned = {
        "userDataDir": str(directory), "executablePath": "${CHROME_PATH}",
        "autoConnect": False, "isolated": False, "browserUrl": "", "wsEndpoint": "",
        "session": {"enabled": False}, "extraArgs": [],
    }
    settings = read_config(target)
    for path, data in ((profile / ".pi/settings.json", read_config(profile / ".pi/settings.json")), (target, settings)):
        section = data.get("pi-browser-use", {})
        if not isinstance(section, dict):
            raise click.ClickException(f"pi-browser-use must be a JSON object: {path}")
        for key, value in {**BROWSER_DEFAULTS, **owned}.items():
            if key in section and (section[key] != value or type(section[key]) is not type(value)):
                raise click.ClickException(f"Conflicting pi-browser-use.{key}: {path}")
        if path != target and any(key in section for key in ("userDataDir", "executablePath")):
            raise click.ClickException(f"Instance browser paths belong in private settings: {path}")
    return {**settings, "pi-browser-use": {**settings.get("pi-browser-use", {}), **owned}}


def configure_browser(profile: Path, private: Path, *, home: Path, bot: str) -> None:
    settings = browser_settings(profile, private, home=home, bot=bot)
    for directory in browser_directories(home, bot):
        directory.mkdir(parents=True, mode=0o700, exist_ok=True)
        directory.chmod(0o700)
    write_config(private / ".pi/settings.json", settings, ".browser-")


def validate_browser(profile: Path, private: Path, *, home: Path, bot: str, path: str | None = None) -> dict[str, str]:
    expected = browser_settings(profile, private, home=home, bot=bot)
    if read_config(private / ".pi/settings.json") != expected or not all(directory.is_dir() for directory in browser_directories(home, bot)):
        raise click.ClickException(f"Configure the private browser first: {private}")
    executable = shutil.which("chromium-browser", path=path)
    if executable:
        return {"CHROME_PATH": str(Path(executable).absolute())}
    if sys.platform == "darwin":
        return {"CHROME_PATH": ""}
    raise click.ClickException("chromium-browser must be executable on the bot launch PATH")
