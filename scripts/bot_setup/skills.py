"""Link shared context and install each bot's bundled memory skill."""
from shutil import copytree
from pathlib import Path
from os.path import relpath
from typing import Literal

import click


def link_project_context(bot_dir: Path) -> None:
    link_shared_skill(bot_dir, "project-context")


def link_shared_skills(bot_dir: Path, *, role: Literal["pm", "tl"], root: Path | None = None) -> None:
    if role not in {"pm", "tl"}:
        raise click.ClickException(f"Unknown bot role: {role}")
    link_shared_skill(bot_dir, "project-context", root=root)
    checkout = (root or bot_dir.resolve().parent.parent).resolve()
    if bot_dir.resolve() != checkout / "bots" / f"{role}-bot":
        install_memory_skill(bot_dir, role=role, root=checkout)


def install_memory_skill(bot_dir: Path, *, role: Literal["pm", "tl"], root: Path | None = None) -> None:
    bot_dir = bot_dir.resolve()
    root = (root or bot_dir.parent.parent).resolve()
    source = root / "bots" / f"{role}-bot" / ".pi/skills/memory"
    target = bot_dir / ".pi/skills/memory"
    if target.is_dir() and not target.is_symlink():
        return  # Bundled or custom local content is already owned by this bot.
    if target.is_symlink():
        old_names = ("memory", "memory-tl") if role == "tl" else ("memory",)
        owned = {Path(relpath(root / "shared-skills" / name, target.parent)) for name in old_names}
        if target.readlink() not in owned:
            raise click.ClickException(f"Refusing to replace existing skill link: {target}")
    elif target.exists():
        raise click.ClickException(f"Refusing to replace existing local skill: {target}")
    if source.is_symlink() or not (source / "SKILL.md").is_file():
        raise click.ClickException(f"Missing bundled memory skill: {source}")
    if target.is_symlink():
        target.unlink()
    target.parent.mkdir(parents=True, exist_ok=True)
    copytree(source, target)


def link_shared_skill(bot_dir: Path, name: str, *, root: Path | None = None) -> None:
    bot_dir = bot_dir.resolve()
    source = (root or bot_dir.parent.parent) / "shared-skills" / name
    if not source.is_dir():
        raise click.ClickException(f"Missing shared skill: {source}")
    skills = bot_dir / ".pi" / "skills"
    skills.mkdir(parents=True, exist_ok=True)
    link = skills / name
    target = Path(relpath(source, skills))
    if link.is_symlink():
        if link.readlink() == target:
            return
        owned_project = name == "project-context" and link.readlink() == Path("../../../shared-skills/project-context")
        if not owned_project:
            raise click.ClickException(f"Refusing to replace existing skill link: {link}")
        link.unlink()
    if link.exists():
        raise click.ClickException(f"Refusing to replace existing local skill: {link}")
    link.symlink_to(target, target_is_directory=True)
