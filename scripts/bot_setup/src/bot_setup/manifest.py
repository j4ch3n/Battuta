"""Strict, shared bot manifest parsing for checkout and Git-index consumers."""

from pathlib import Path
import tomllib
from typing import Annotated

import click
from pydantic import BaseModel, ConfigDict, StringConstraints, ValidationError, field_validator


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


class BotManifest(Section):
    skills: Skills


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
