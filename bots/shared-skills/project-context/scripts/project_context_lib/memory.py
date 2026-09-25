"""Explicit APIs for shared project-specific PM/Tech Lead memory."""

from pathlib import Path
import os
import tempfile

import click

from .registry import ProjectConfig, ProjectRegistry, load_project


def _memory_path(project: ProjectConfig) -> Path:
    if project.registry_root is None:
        raise click.ClickException("Project config must be loaded from a project registry")
    directory = project.config_path.parent
    expected = project.registry_root / project.name / "project.yaml"
    if project.config_path.absolute() != expected.absolute():
        raise click.ClickException(f"Project config is outside its registry location: {project.config_path}")
    path = directory / "MEMORY.md"
    try:
        if path.is_symlink() or not path.resolve(strict=False).is_relative_to(directory.resolve(strict=False)):
            raise click.ClickException(f"Memory path must not be a symlink or escape project directory: {path}")
    except (OSError, RuntimeError) as error:
        raise click.ClickException(f"Invalid memory path {path}: {error}") from error
    return path


def read_memory(project: ProjectConfig | str, *, root: Path | None = None) -> str:
    """Explicitly read shared memory; never inject it into a runtime automatically."""
    config = project if isinstance(project, ProjectConfig) else load_project(project, root=root)
    path = _memory_path(config)
    try:
        if path.is_symlink():
            raise click.ClickException(f"Memory path must not be a symlink: {path}")
        return path.read_text(encoding="utf-8") if path.exists() else ""
    except click.ClickException:
        raise
    except OSError as error:
        raise click.ClickException(f"Cannot read {path}: {error}") from error


def write_memory(project: ProjectConfig | str, content: str, *, root: Path | None = None) -> Path:
    """Explicitly create or replace shared project memory."""
    config = project if isinstance(project, ProjectConfig) else load_project(project, root=root)
    if not isinstance(content, str):
        raise click.ClickException("memory content must be text")
    path = _memory_path(config)
    try:
        if path.is_symlink():
            raise click.ClickException(f"Memory path must not be a symlink: {path}")
        fd, temporary = tempfile.mkstemp(prefix=".MEMORY.md.", dir=path.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as output:
                output.write(content)
                output.flush()
                os.fsync(output.fileno())
            os.chmod(temporary, 0o600)
            if path.is_symlink():
                raise click.ClickException(f"Memory path must not be a symlink: {path}")
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    except click.ClickException:
        raise
    except OSError as error:
        raise click.ClickException(f"Cannot write {path}: {error}") from error
    return path
