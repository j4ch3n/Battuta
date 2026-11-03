"""Validate skill selection metadata against the canonical catalog."""

from pathlib import Path
import re
import stat
import subprocess
from typing import Annotated

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

