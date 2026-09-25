"""Install shared Pi skills into the management bot workspaces."""
from pathlib import Path

import click


def link_project_context(bot_dir: Path) -> None:
    bot_dir = bot_dir.resolve()
    source = bot_dir.parent / "shared-skills" / "project-context"
    if not source.is_dir():
        raise click.ClickException(f"Missing shared skill: {source}")
    skills = bot_dir / ".pi" / "skills"
    skills.mkdir(parents=True, exist_ok=True)
    link = skills / "project-context"
    target = Path("../../../shared-skills/project-context")
    if link.is_symlink():
        if link.readlink() == target:
            return
        raise click.ClickException(f"Refusing to replace existing skill link: {link}")
    if link.exists():
        raise click.ClickException(f"Refusing to replace existing local skill: {link}")
    link.symlink_to(target, target_is_directory=True)
