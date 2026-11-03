"""Expose manifest-selected hub skills without overwriting custom content."""

import json
from os.path import relpath
from pathlib import Path
import subprocess
from typing import Literal

import click


def _owned_skill_targets(root: Path, skills: Path, name: str) -> set[Path]:
    old_names = ("memory", "memory-tl") if name == "memory" else (name,)
    targets = {Path(relpath(root / "shared-skills" / old, skills)) for old in old_names}
    targets.add(Path(relpath(root / "skills-hub" / name, skills)))
    if name == "project-context":
        targets.add(Path("../../../shared-skills/project-context"))
    return targets


def link_shared_skills(bot_dir: Path, *, role: Literal["pm", "tl"], root: Path | None = None) -> None:
    if role not in {"pm", "tl"}:
        raise click.ClickException(f"Unknown bot role: {role}")
    bot_dir = bot_dir.resolve()
    root = (root or bot_dir.parent.parent).resolve()
    manifest = bot_dir / "skills.json"
    if not manifest.exists():
        manifest = root / f"bots/{role}-bot/skills.json"
    helper = Path(__file__).resolve().parents[2] / "bot-setup/skills.mjs"
    try:
        result = subprocess.run(
            ["node", str(helper), str(manifest), str(root / "skills-hub")],
            check=True, capture_output=True, text=True,
        )
        names = json.loads(result.stdout)
    except subprocess.CalledProcessError as error:
        raise click.ClickException(error.stderr.strip() or "Skill validation failed") from error
    except OSError as error:
        raise click.ClickException(f"Cannot run skill validation: {error}") from error

    skills = bot_dir / ".pi/skills"
    if skills.is_symlink() or (skills.exists() and not skills.is_dir()):
        raise click.ClickException(f"Expected a local skill directory, refusing to replace: {skills}")
    links = []
    for name in names:
        link = skills / name
        target = Path(relpath(root / "skills-hub" / name, skills))
        if link.is_symlink():
            existing = link.readlink()
            if existing == target:
                continue
            if existing not in _owned_skill_targets(root, skills, name):
                raise click.ClickException(f"Refusing to replace existing skill link: {link}")
        elif link.is_dir():
            continue  # Custom or bundled directories retain their owner's content.
        elif link.exists():
            raise click.ClickException(f"Refusing to replace existing local skill: {link}")
        links.append((link, target))

    removals = []
    if skills.is_dir():
        for link in skills.iterdir():
            if (
                link.name not in names
                and link.is_symlink()
                and link.readlink() in _owned_skill_targets(root, skills, link.name)
            ):
                removals.append(link)

    skills.mkdir(parents=True, exist_ok=True)
    for link in removals:
        link.unlink()
    for link, target in links:
        if link.is_symlink():
            link.unlink()
        link.symlink_to(target, target_is_directory=True)
