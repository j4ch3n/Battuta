"""Pi package configuration shared by bot setup."""

import re
import json
from pathlib import Path

import click
from .files import safe_path
from .manifest import BotManifest


def render_worker_agents(profile: Path, manifest: BotManifest) -> dict[str, bytes]:
    if manifest.subagents is None:
        raise click.ClickException("Worker manifest requires subagents")
    rendered = {}
    for agent in manifest.subagents.agents:
        path = safe_path(profile, agent.path)
        if path.suffix != ".md" or path.name in rendered:
            raise click.ClickException("Subagent prompts must have unique Markdown filenames")
        if len(set(agent.inherit_parent_skills)) != len(agent.inherit_parent_skills) or not set(agent.inherit_parent_skills) <= set(manifest.skills.include):
            raise click.ClickException(f"Subagent skills must be selected by the worker: {path}")
        if len(set(agent.extensions)) != len(agent.extensions):
            raise click.ClickException(f"Duplicate subagent extensions: {path}")
        for extension in agent.extensions:
            if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", extension) or not any(
                package.startswith(f"npm:{extension}@") for package in manifest.packages.pi
            ):
                raise click.ClickException(f"Subagent extension is not installed: {extension}")
        try:
            text = path.read_text()
        except OSError as error:
            raise click.ClickException(f"Cannot read subagent prompt: {path}") from error
        parts = text.split("---\n", 2)
        if len(parts) != 3 or parts[0] or re.search(r"^(?:skills|extensions)\s*:", parts[1], re.MULTILINE):
            raise click.ClickException(f"Invalid or conflicting subagent frontmatter: {path}")
        skills = json.dumps(agent.inherit_parent_skills) if agent.inherit_parent_skills else "false"
        extensions = json.dumps(agent.extensions) if agent.extensions else "false"
        rendered[path.name] = f"---\n{parts[1]}skills: {skills}\nextensions: {extensions}\n---\n{parts[2]}".encode()
    return rendered


def prepare_worker_agents(contents: dict[str, bytes], bot_dir: Path) -> None:
    """Create missing definitions without overwriting existing files."""
    _prepare_files(contents, bot_dir / ".pi/agents")


def prepare_worker_skill(source: Path, bot_dir: Path) -> None:
    """Create missing skill files without overwriting existing files."""
    names = ["SKILL.md", *[
        str(path.relative_to(source)) for path in sorted(source.rglob("*"))
        if path.is_file() and path != source / "SKILL.md"
    ]]
    _prepare_files(
        {name: (source / name).read_bytes() for name in names}, bot_dir / ".pi/skills" / source.name,
    )


def _prepare_files(contents: dict[str, bytes], destination: Path) -> None:
    for parent in (destination, *destination.parents):
        if parent.is_symlink() or (parent.exists() and not parent.is_dir()):
            raise click.ClickException(f"Refusing custom subagent directory: {parent}")
    pending = {}
    for name, content in contents.items():
        target = destination / name
        for parent in target.parents:
            if parent == destination:
                break
            if parent.is_symlink() or (parent.exists() and not parent.is_dir()):
                raise click.ClickException(f"Refusing custom subagent directory: {parent}")
        if target.is_symlink() or (target.exists() and not target.is_file()):
            raise click.ClickException(f"Refusing custom subagent path: {target}")
        if not target.exists():
            pending[name] = content
    destination.mkdir(parents=True, exist_ok=True)
    for name, content in pending.items():
        (destination / name).parent.mkdir(parents=True, exist_ok=True)
        try:
            with (destination / name).open("xb") as file:
                file.write(content)
        except FileExistsError:
            pass
