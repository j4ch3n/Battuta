"""Install shared Pi skills into the management bot workspaces."""
from pathlib import Path

import click


def link_project_context(bot_dir: Path) -> None:
    link_shared_skill(bot_dir, "project-context")


def link_shared_skills(bot_dir: Path) -> None:
    for name in ("project-context", "memory"):
        link_shared_skill(bot_dir, name)


def link_shared_skill(bot_dir: Path, name: str) -> None:
    bot_dir = bot_dir.resolve()
    source = bot_dir.parent.parent / "shared-skills" / name
    if not source.is_dir():
        raise click.ClickException(f"Missing shared skill: {source}")
    skills = bot_dir / ".pi" / "skills"
    skills.mkdir(parents=True, exist_ok=True)
    link = skills / name
    target = Path(f"../../../../shared-skills/{name}")
    if link.is_symlink():
        if link.readlink() == target:
            return
        if name != "project-context" or link.readlink() != Path("../../../shared-skills/project-context"):
            raise click.ClickException(f"Refusing to replace existing skill link: {link}")
        link.unlink()
    if link.exists():
        raise click.ClickException(f"Refusing to replace existing local skill: {link}")
    link.symlink_to(target, target_is_directory=True)
