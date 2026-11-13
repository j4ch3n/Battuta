"""Strict, shared bot manifest parsing for checkout and Git-index consumers."""

from pathlib import Path
import tomllib
from typing import Annotated, Literal

import click
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, ValidationError, field_validator


class Section(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid", hide_input_in_errors=True)


class Skills(Section):
    include: list[Annotated[str, StringConstraints(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")]]

    @field_validator("include")
    @classmethod
    def unique(cls, names: list[str]) -> list[str]:
        if len(names) != len(set(names)):
            raise ValueError("Duplicate skill names")
        return names


class Identity(Section):
    role: Literal["cos", "manager", "worker"]
    env_prefix: Annotated[str, StringConstraints(pattern=r"^[A-Z][A-Z0-9_]*$")]


class Packages(Section):
    pi: list[str] = Field(default_factory=list)
    node_projects: list[str] = Field(default_factory=list)


class FileSource(Section):
    root: Literal["repository", "profile"]
    path: str


class FileRule(Section):
    operation: Literal["copy", "concatenate"]
    sources: list[FileSource] = Field(min_length=1)
    target: str
    destination: Literal["profile", "private"]
    policy: Literal["replace", "create-only"]
    optional: bool = False


class Setup(Section):
    steps: list[Literal["telegram", "mcp", "memory-settings", "browser", "dream", "manager-cleanup", "worker-profile"]]


class BotManifest(Section):
    skills: Skills
    bot: Identity | None = None
    packages: Packages = Field(default_factory=Packages)
    files: list[FileRule] = Field(default_factory=list)
    setup: Setup | None = None


def parse_manifest(text: str, path: Path) -> BotManifest:
    try:
        return BotManifest.model_validate(tomllib.loads(text))
    except (ValueError, ValidationError) as error:
        raise click.ClickException(f"Invalid bot manifest: {path}") from error


def load_manifest(path: Path) -> BotManifest:
    try:
        if path.is_symlink():
            raise click.ClickException(f"Expected a regular bot manifest: {path}")
        return parse_manifest(path.read_text(), path)
    except OSError as error:
        raise click.ClickException(f"Cannot read bot manifest: {path}") from error


def load_profile(path: Path, role: str) -> BotManifest:
    manifest = load_manifest(path)
    if manifest.bot is None or manifest.bot.role != role or manifest.setup is None:
        raise click.ClickException(f"Missing or conflicting bot/setup sections: {path}")
    allowed = {
        "cos": {"telegram", "mcp", "memory-settings", "browser", "dream"},
        "manager": {"mcp", "memory-settings", "manager-cleanup"},
        "worker": {"worker-profile"},
    }[role]
    if len(set(manifest.setup.steps)) != len(manifest.setup.steps) or not set(manifest.setup.steps) <= allowed:
        raise click.ClickException(f"Invalid setup steps for {role}: {path}")
    return manifest
