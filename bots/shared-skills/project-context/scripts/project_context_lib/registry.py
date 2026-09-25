"""Versioned, file-based project configuration."""

from dataclasses import dataclass, replace
import os
from pathlib import Path
import re
import tempfile
from typing import Any

import click
import yaml


CONFIG_VERSION = 1
# Linux filenames may contain any character except '/' and NUL; '.' and '..' are reserved.
_SAFE_NAME = re.compile(r"(?!\.{1,2}\Z)[^/\x00]+")


@dataclass(frozen=True)
class ProjectRoles:
    engineer: str
    reviewer: str


@dataclass(frozen=True)
class ProjectConfig:
    name: str
    path: Path
    linear_project_id: str | None
    linear_team_id: str | None
    github_repository: str | None
    roles: ProjectRoles
    config_path: Path
    registry_root: Path | None = None


def _optional_string(value: Any, field: str) -> str | None:
    if value is not None and (not isinstance(value, str) or not value.strip()):
        raise click.ClickException(f"{field} must be a non-empty string or null")
    return value


def _parse(data: Any, config_path: Path) -> ProjectConfig:
    if not isinstance(data, dict) or data.get("version") != CONFIG_VERSION:
        raise click.ClickException(f"{config_path}: expected project config version {CONFIG_VERSION}")
    sections = ("project", "linear", "github", "roles")
    if any(not isinstance(data.get(key), dict) for key in sections):
        raise click.ClickException(f"{config_path}: project, linear, github, and roles must be mappings")
    project, linear, github, roles = (data[key] for key in sections)
    allowed = {"version", "project", "linear", "github", "roles"}
    if set(data) != allowed or set(project) != {"name", "path"} or set(linear) != {"project_id", "team_id"} or set(github) != {"repository"} or set(roles) != {"engineer", "reviewer"}:
        raise click.ClickException(f"{config_path}: config contains missing or unsupported fields")
    name, path = project.get("name"), project.get("path")
    if not isinstance(name, str) or not _SAFE_NAME.fullmatch(name):
        raise click.ClickException(f"{config_path}: project.name must be a valid directory name")
    if not isinstance(path, str) or not path.strip():
        raise click.ClickException(f"{config_path}: project.path must be a non-empty path")
    try:
        project_path = Path(path).expanduser().resolve(strict=False)
    except (OSError, RuntimeError) as error:
        raise click.ClickException(f"{config_path}: invalid project.path: {error}") from error
    role_names = [roles.get("engineer"), roles.get("reviewer")]
    if any(not isinstance(role, str) or not role.strip() for role in role_names):
        raise click.ClickException(f"{config_path}: roles.engineer and roles.reviewer must be non-empty strings")
    return ProjectConfig(
        name, project_path,
        _optional_string(linear.get("project_id"), "linear.project_id"),
        _optional_string(linear.get("team_id"), "linear.team_id"),
        _optional_string(github.get("repository"), "github.repository"),
        ProjectRoles(*role_names), config_path,
    )


class ProjectRegistry:
    """Registry rooted at ``~/.battuta/projects`` by default."""

    def __init__(self, root: Path | None = None):
        self.root = (root or Path.home() / ".battuta" / "projects").expanduser().resolve(strict=False)

    def _directory(self, name: str) -> Path:
        directory = self.root / name
        try:
            if directory.is_symlink() or not directory.resolve(strict=False).is_relative_to(self.root):
                raise click.ClickException(f"Project directory escapes registry root: {directory}")
        except (OSError, RuntimeError) as error:
            raise click.ClickException(f"Invalid project directory {directory}: {error}") from error
        return directory

    def load(self, name: str, project_path: Path | None = None) -> ProjectConfig:
        if not isinstance(name, str) or not _SAFE_NAME.fullmatch(name):
            raise click.ClickException("project name must be a valid directory name (no '/', NUL, '.' or '..')")
        directory = self._directory(name)
        config_path = directory / "project.yaml"
        if config_path.is_symlink():
            raise click.ClickException(f"Config entry must not be a symlink: {config_path}")
        if not config_path.exists():
            if project_path is None:
                raise click.ClickException(f"No config at {config_path}; provide a project path to initialize it")
            directory.mkdir(parents=True, exist_ok=True)
            try:
                normalized_path = project_path.expanduser().resolve(strict=False)
            except (OSError, RuntimeError) as error:
                raise click.ClickException(f"Invalid project path: {error}") from error
            initial = yaml.safe_dump({
                "version": CONFIG_VERSION,
                "project": {"name": name, "path": str(normalized_path)},
                "linear": {"project_id": None, "team_id": None},
                "github": {"repository": None},
                "roles": {"engineer": "Engineer", "reviewer": "Reviewer"},
            }, sort_keys=False)
            fd, temporary = tempfile.mkstemp(prefix=".project.yaml.", dir=directory)
            try:
                with os.fdopen(fd, "w") as output:
                    output.write(initial)
                os.chmod(temporary, 0o600)
                try:
                    os.link(temporary, config_path)
                except FileExistsError:
                    pass
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
        elif project_path is not None:
            raise click.ClickException(f"Project config already exists: {config_path}")
        if config_path.is_symlink() or not config_path.resolve(strict=False).is_relative_to(self.root):
            raise click.ClickException(f"Config entry escapes registry root: {config_path}")
        try:
            with config_path.open(encoding="utf-8") as source:
                data = yaml.safe_load(source)
        except (OSError, yaml.YAMLError) as error:
            raise click.ClickException(f"Cannot read {config_path}: {error}") from error
        config = _parse(data, config_path)
        if config.name != name:
            raise click.ClickException(
                f"{config_path}: project.name {config.name!r} does not match registry name {name!r}"
            )
        return replace(config, registry_root=self.root)


def load_project(name: str, project_path: Path | None = None, root: Path | None = None) -> ProjectConfig:
    """Load a project config, lazily initializing it only when project_path is given."""
    return ProjectRegistry(root).load(name, project_path)
