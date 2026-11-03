"""Expose manifest-selected hub skills without overwriting custom content."""

import json
from os.path import relpath
from pathlib import Path
import subprocess
from typing import Literal

import click


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
    links = []
    for name in names:
        link = skills / name
        target = Path(relpath(root / "skills-hub" / name, skills))
        if link.is_symlink():
            existing = link.readlink()
            if existing == target:
                continue
            old_names = ("memory", "memory-tl") if name == "memory" else (name,)
            owned = {Path(relpath(root / "shared-skills" / old, skills)) for old in old_names}
            if name == "project-context":
                owned.add(Path("../../../shared-skills/project-context"))
            if existing not in owned:
                raise click.ClickException(f"Refusing to replace existing skill link: {link}")
        elif link.is_dir():
            continue  # Custom or bundled directories retain their owner's content.
        elif link.exists():
            raise click.ClickException(f"Refusing to replace existing local skill: {link}")
        links.append((link, target))

    skills.mkdir(parents=True, exist_ok=True)
    for link, target in links:
        if link.is_symlink():
            link.unlink()
        link.symlink_to(target, target_is_directory=True)
