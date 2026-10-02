"""Validated persistent contracts and internal command data."""

from pathlib import Path
import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator


Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


def project_name(value: str) -> str:
    if not value or value in {".", "..", ".config.json"} or "/" in value or "\x00" in value:
        raise ValueError("project name must be a direct folder name (not '/', NUL, '.', '..', or '.config.json')")
    return value


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True, validate_default=True)


class LinearProject(Model):
    id: Text
    name: Text
    url: Text


class CurrentConfig(Model):
    model_config = ConfigDict(extra="allow")
    current_project: str | None = Field(default=None, alias="currentProject")

    @field_validator("current_project")
    @classmethod
    def selected_name(cls, value):
        return project_name(value) if value is not None else None


class ProjectMetadata(Model):
    name: str
    path: Path

    _name = field_validator("name")(project_name)

    @field_validator("path", mode="before")
    @classmethod
    def parse_path(cls, value):
        if isinstance(value, str) and value.strip():
            return Path(value).expanduser()
        return value


class LinearConfig(Model):
    project_id: Text | None = None
    team_id: Text | None = None


class GithubConfig(Model):
    repository: Text | None = None


class ProjectConfig(Model):
    version: Literal[1] = 1
    project: ProjectMetadata
    linear: LinearConfig = Field(default_factory=LinearConfig)
    github: GithubConfig = Field(default_factory=GithubConfig)

    @field_validator("version", mode="before")
    @classmethod
    def integer_version(cls, value):
        if type(value) is not int:
            raise ValueError("version must be the integer 1")
        return value


class Repository(Model):
    url: str
    owner: str
    name: str

    @field_validator("name")
    @classmethod
    def repository_name(cls, value: str) -> str:
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", value):
            raise ValueError("repository name must start with a letter or number and contain only letters, numbers, '.', '_' or '-'")
        return value

    @classmethod
    def from_url(cls, url: str) -> "Repository":
        match = re.fullmatch(
            r"(?:https://github\.com/|git@github\.com:|ssh://git@github\.com/)"
            r"(?P<owner>[A-Za-z0-9][A-Za-z0-9-]*)/(?P<repo>[A-Za-z0-9][A-Za-z0-9_.-]*)/?",
            url,
        )
        if not match:
            raise ValueError("Expected a GitHub HTTPS or SSH repository URL (not a branch or file URL)")
        name = match["repo"].removesuffix(".git")
        return cls(url=url, owner=match["owner"], name=name)


class ProjectContext(Model):
    name: str
    root: Path
    code: Path
    config: ProjectConfig


class LinearResult(Model):
    operation: Literal["link", "create"]
    project: ProjectContext
    remote: LinearProject | None = None


class MemoryEntry(Model):
    index: int = Field(ge=1)
    content: str


class MemoryResult(Model):
    project: str
    operation: Literal["append", "replace", "replaceAll", "get"]
    count: int = Field(ge=0)
    entries: list[MemoryEntry] = Field(default_factory=list)


class CheckoutEntry(Model):
    path: str
    is_directory: bool


class Explanation(Model):
    project: str
    root: Path
    repository_url: str | None = None
    linear_project_url: str | None = None
    readme: str | None
    agents: str | None
    sub_readmes: list[str]
    sub_agents: list[str]
    tree: list[str]
