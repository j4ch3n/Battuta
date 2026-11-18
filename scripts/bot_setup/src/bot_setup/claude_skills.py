"""Share selected bot skills with every Claude Code session on the host."""

import os
from pathlib import Path

import click

from .files import write_file
from .manifest import BotManifest


def claude_dir(home: Path) -> Path:
    return Path(os.environ.get("CLAUDE_CONFIG_DIR") or home / ".claude")


def prepared_claude_skills(profile: Path, manifest: BotManifest) -> list[tuple[str, Path]]:
    """The manifest's Claude skills with their prepared source directories; fails if one is missing."""
    skills = []
    for name in manifest.claude.skills if manifest.claude else []:
        source = profile / ".pi/skills" / name
        if not (source / "SKILL.md").is_file():
            raise click.ClickException(f"Claude skill {name} is not prepared under {source}")
        skills.append((name, source))
    return skills


def install_claude_skills(profile: Path, manifest: BotManifest, home: Path) -> list[tuple[Path, bool]]:
    """Copy the skills into Claude Code's user directory; files already there are kept."""
    results = []
    for name, source in prepared_claude_skills(profile, manifest):
        for file in sorted(path for path in source.rglob("*") if path.is_file()):
            target = claude_dir(home) / "skills" / name / file.relative_to(source)
            results.append((target, write_file(target, file.read_bytes(), policy="create-only")))
    return results
