"""Configure the native TL package without replacing private runtime state."""
from pathlib import Path

from .install import run


def configure_subagents(bot_dir: Path, *, root: Path) -> None:
    run("node", str(root / "packaging/configure-subagents.mjs"), str(bot_dir))
