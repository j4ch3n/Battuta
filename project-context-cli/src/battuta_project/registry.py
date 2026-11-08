"""Filesystem-owned project discovery, initialization, and associations."""

from pathlib import Path
import shutil
import subprocess

import click
from jinja2 import TemplateError
from pydantic import ValidationError
import yaml

from .models import GithubConfig, LinearConfig, ProjectConfig, ProjectContext, Repository, project_name
from .discovery import ProjectDiscovery
from .presentation import render
from .storage import atomic_write, check_registry_root, file_errors, regular_file


class ProjectRegistry:
    def __init__(self):
        self.root = (Path.home() / ".battuta" / "projects").absolute()
        self.discovery = ProjectDiscovery(self.root)

    def _directory(self, name: str) -> Path:
        check_registry_root(self.root)
        try:
            project_name(name)
        except ValueError as error:
            raise click.ClickException(str(error)) from error
        directory = self.root / name
        if directory.is_symlink():
            raise click.ClickException(f"Project directory must not be a symlink: {directory}")
        return directory

    def load(self, name: str) -> ProjectContext:
        with file_errors():
            directory = self._directory(name)
            self.discovery.require_project(directory, name)
            path = directory / "project.yaml"
            regular_file(path)
            try:
                config = ProjectConfig.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")))
            except (ValidationError, yaml.YAMLError, UnicodeError) as error:
                raise click.ClickException(f"{path}: {error}") from error
            code = directory / "code"
            if code.is_symlink() or not code.is_dir():
                raise click.ClickException(f"Checkout must be a real directory at {code}")
            return ProjectContext(name=name, root=directory, code=code, config=config)

    def names(self) -> list[str]:
        return self.discovery.names()

    def list_projects(self) -> list[ProjectContext]:
        return [self.load(name) for name in self.names()]

    @staticmethod
    def _write_project(directory: Path, config: ProjectConfig) -> None:
        atomic_write(directory / "project.yaml", yaml.safe_dump(config.model_dump(mode="json"), sort_keys=False))

    def link_linear(self, project: ProjectContext, linear: LinearConfig) -> ProjectContext:
        with file_errors():
            project = self.load(project.name)
            config = project.config.model_copy(update={"linear": linear})
            self._write_project(project.root, config)
            return project.model_copy(update={"config": config})

    def link_github(self, project: ProjectContext, url: str) -> ProjectContext:
        try:
            repository = Repository.from_url(url)
        except ValueError as error:
            raise click.ClickException(str(error)) from error
        with file_errors():
            project = self.load(project.name)
            config = project.config.model_copy(update={
                "github": GithubConfig(repository=f"{repository.owner}/{repository.name}"),
            })
            self._write_project(project.root, config)
            return project.model_copy(update={"config": config})

    def init(self, name: str, *, github: str | None = None, linear: LinearConfig | None = None) -> ProjectContext:
        try:
            repository = Repository.from_url(github) if github is not None else None
        except ValueError as error:
            raise click.ClickException(str(error)) from error
        with file_errors():
            directory = self._directory(name)
            if directory.exists():
                raise click.ClickException(f"Project directory already exists: {directory}")
            self.root.mkdir(parents=True, exist_ok=True)
            directory.mkdir()
            code = directory / "code"
            try:
                if repository is not None:
                    subprocess.run(["gh", "repo", "clone", repository.url, str(code)], check=True)
                else:
                    code.mkdir()
                config = ProjectConfig(
                    github=GithubConfig(repository=f"{repository.owner}/{repository.name}" if repository else None),
                    linear=linear or LinearConfig(),
                )
                self._write_project(directory, config)
                project = self.load(name)
                try:
                    summary = render("summary.md.j2", project)
                except TemplateError as error:
                    raise click.ClickException(f"Cannot render project summary: {error}") from error
                atomic_write(directory / "SUMMARY.md", summary + "\n")
                return project
            except (OSError, subprocess.CalledProcessError, click.ClickException) as error:
                shutil.rmtree(directory)
                if isinstance(error, FileNotFoundError):
                    raise click.ClickException("GitHub CLI 'gh' was not found; install it and run gh auth login.") from error
                if isinstance(error, subprocess.CalledProcessError):
                    raise click.ClickException(f"gh repo clone failed (exit {error.returncode}); new project was removed.") from error
                raise
