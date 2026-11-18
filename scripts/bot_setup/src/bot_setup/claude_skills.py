"""Share the manifest's Claude skills with every Claude Code session on the host."""

import os
from pathlib import Path

import click

from .files import write_file
from .manifest import BotManifest

# Release bundles stage Claude-only skills here, apart from the Pi skills.
CLAUDE_SKILLS = ".claude-skills"


def claude_dir(home: Path) -> Path:
    return Path(os.environ.get("CLAUDE_CONFIG_DIR") or home / ".claude")


def prepared_claude_skills(catalog: Path, manifest: BotManifest) -> list[tuple[str, Path]]:
    """The manifest's Claude skills with their source directories in the catalog; fails if one is missing."""
    skills = []
    for name in manifest.claude.skills if manifest.claude else []:
        source = catalog / name
        if not (source / "SKILL.md").is_file():
            raise click.ClickException(f"Claude skill {name} is missing from {catalog}")
        skills.append((name, source))
    return skills


def install_claude_skills(catalog: Path, manifest: BotManifest, home: Path) -> list[tuple[Path, bool]]:
    """Copy the skills into Claude Code's user directory; files already there are kept."""
    results = []
    for name, source in prepared_claude_skills(catalog, manifest):
        for file in sorted(path for path in source.rglob("*") if path.is_file()):
            target = claude_dir(home) / "skills" / name / file.relative_to(source)
            results.append((target, write_file(target, file.read_bytes(), policy="create-only")))
    return results
