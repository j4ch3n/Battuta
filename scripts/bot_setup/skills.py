"""Install shared Pi skills into the management bot workspaces."""
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
    link_shared_skill(bot_dir, "memory", source_name="memory-tl" if role == "tl" else "memory", root=root)


def link_shared_skill(bot_dir: Path, name: str, *, source_name: str | None = None, root: Path | None = None) -> None:
    bot_dir = bot_dir.resolve()
    source_name = source_name or name
    source = (root or bot_dir.parent.parent) / "shared-skills" / source_name
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
        owned_tl_memory = name == "memory" and source_name == "memory-tl" and link.readlink() == Path("../../../../shared-skills/memory")
        if not (owned_project or owned_tl_memory):
            raise click.ClickException(f"Refusing to replace existing skill link: {link}")
        link.unlink()
    if link.exists():
        raise click.ClickException(f"Refusing to replace existing local skill: {link}")
    link.symlink_to(target, target_is_directory=True)
