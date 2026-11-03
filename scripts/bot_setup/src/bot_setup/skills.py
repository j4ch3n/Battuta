"""Expose manifest-selected hub skills without overwriting custom content."""

from os.path import relpath
from pathlib import Path
import re
import stat
import subprocess
from typing import Annotated, Literal

import click
from pydantic import BaseModel, ConfigDict, StringConstraints, ValidationError, field_validator


class SkillManifest(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid", hide_input_in_errors=True)
    skills: list[Annotated[str, StringConstraints(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")]]

    @field_validator("skills")
    @classmethod
    def unique(cls, names: list[str]) -> list[str]:
        if len(names) != len(set(names)):
            raise ValueError("Duplicate skill names")
        return names


def _selection(text: str, manifest: Path) -> list[str]:
    try:
        return SkillManifest.model_validate_json(text).skills
    except ValidationError as error:
        raise click.ClickException(f"Invalid skill manifest: {manifest}") from error


def load_selection(manifest: Path, catalog: Path) -> list[str]:
    try:
        hub = catalog.resolve(strict=True)
        names = _selection(manifest.read_text(), manifest)
        for name in names:
            entry = hub / name / "SKILL.md"
            if not entry.resolve(strict=True).is_relative_to(hub) or not stat.S_ISREG(entry.lstat().st_mode):
                raise click.ClickException(f"Missing skill or invalid entry point: {entry}")
        return names
    except OSError as error:
        raise click.ClickException(f"Missing skill manifest or entry point: {error.filename}") from error


def check_manifests(root: Path, *, staged: bool = False) -> None:
    if not staged:
        manifests = sorted((root / "bots").glob("*/skills.json"))
        if not manifests:
            raise click.ClickException("Missing skill manifests")
        for manifest in manifests:
            load_selection(manifest, root / "skills-hub")
        return
    def git(*args):
        return subprocess.check_output(["git", *args], cwd=root, text=True)
    entries = {}
    for row in filter(None, git("ls-files", "--stage", "-z").split("\0")):
        header, path = row.split("\t", 1)
        mode, oid, stage = header.split()
        if stage != "0":
            raise click.ClickException(f"Unresolved conflict in skill index: {path}")
        entries[path] = (mode, oid)
    manifests = [path for path in entries if re.fullmatch(r"bots/[^/]+/skills\.json", path)]
    if not manifests:
        raise click.ClickException("Missing skill manifests in Git index")
    for manifest in manifests:
        mode, oid = entries[manifest]
        if mode not in {"100644", "100755"}:
            raise click.ClickException(f"Invalid skill manifest file: {manifest}")
        for name in _selection(git("cat-file", "blob", oid), Path(manifest)):
            entry = entries.get(f"skills-hub/{name}/SKILL.md")
            if not entry or entry[0] not in {"100644", "100755"}:
                raise click.ClickException(f"Missing skill entry point in Git index: {name}")


def validate_bundle(bot_dir: Path) -> list[str]:
    skills = bot_dir / ".pi/skills"
    if skills.is_symlink() or not skills.is_dir():
        raise click.ClickException(f"Expected a local bundled skills directory: {skills}")
    names = load_selection(bot_dir / "skills.json", skills)
    entries = list(skills.iterdir())
    if {entry.name for entry in entries} != set(names) or any(entry.is_symlink() or not entry.is_dir() for entry in entries):
        raise click.ClickException(f"Bundled skills do not match manifest: {bot_dir}")
    if any(entry.is_symlink() for entry in skills.rglob("*")):
        raise click.ClickException(f"Unexpected bundled skill link: {skills}")
    return names


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
    names = load_selection(manifest, root / "skills-hub")

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
