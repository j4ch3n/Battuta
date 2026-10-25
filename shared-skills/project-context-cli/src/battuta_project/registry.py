"""Managed workspace initialization and persisted current-project selection."""

from pathlib import Path
import shutil
import subprocess

import click
from jinja2 import TemplateError
from pydantic import ValidationError
import yaml

from .models import CurrentConfig, GithubConfig, LinearConfig, ProjectConfig, ProjectContext, ProjectMetadata, Repository, RoleWorkConfig, WorkConfig, WorkRecord, project_name
from .discovery import ProjectDiscovery
from .presentation import render
from .storage import atomic_write, check_registry_root, file_errors, file_lock, regular_file


class ProjectRegistry:
    def __init__(self, root: Path | None = None):
        self.root = (root or Path.home() / ".battuta" / "projects").expanduser().absolute()
        self.discovery = ProjectDiscovery(self.root)

    @property
    def state_path(self) -> Path:
        return self.root / ".config.json"

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

    def state(self) -> CurrentConfig:
        with file_errors():
            check_registry_root(self.root)
            regular_file(self.state_path)
            if not self.state_path.exists():
                return CurrentConfig()
            try:
                return CurrentConfig.model_validate_json(self.state_path.read_text(encoding="utf-8"))
            except ValidationError as error:
                raise click.ClickException(f"{self.state_path}: {error}") from error

    def _check_state(self) -> None:
        check_registry_root(self.root)
        regular_file(self.state_path)
        if self.state_path.exists():
            self.state()

    def _write_state(self, state: CurrentConfig) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        atomic_write(self.state_path, state.model_dump_json(by_alias=True, exclude_unset=True, indent=2) + "\n")

    def _select(self, project: ProjectContext) -> None:
        with self.locked(create=True):
            state = self.state().model_copy(update={"current_project": project.name})
            self._write_state(state)

    def locked(self, *, create: bool = False):
        return file_lock(self.root / ".config.lock", create=create)

    def _work_config(self, project: str | None) -> WorkConfig:
        state = self.state()
        return state.general if project is None else state.projects.get(project, WorkConfig())

    def current_work_id(self, project: str | None, role: str) -> str | None:
        return self._work_config(project).roles.get(role, RoleWorkConfig()).current_work_id

    def current_note_work_id(self, project: str | None, role: str) -> str | None:
        return self._work_config(project).roles.get(role, RoleWorkConfig()).current_note_work_id

    def work_record(self, project: str | None, role: str, work_id: str) -> WorkRecord | None:
        return self._work_config(project).roles.get(role, RoleWorkConfig()).works.get(work_id)

    def set_work_id(self, project: str | None, role: str, work_id: str, *, related_to: str | None = None) -> None:
        """Publish new work while the caller holds the registry lock."""
        self._publish_work(project, role, work_id, "currentWorkId", related_to)

    def set_note_work_id(self, project: str | None, role: str, work_id: str) -> None:
        """Publish a notebook without changing the TODO selection; caller holds the lock."""
        self._publish_work(project, role, work_id, "currentNoteWorkId")

    def _publish_work(self, project: str | None, role: str, work_id: str, selection: str, related_to: str | None = None) -> None:
        state = self.state().model_dump(by_alias=True)
        boundary = state["general"] if project is None else state["projects"].setdefault(project, {})
        entry = boundary.setdefault("roles", {}).setdefault(role, {})
        works = entry.setdefault("works", {})
        if work_id in works:
            raise click.ClickException(f"Work already exists: {role}:{work_id}")
        works[work_id] = {"relatedTo": related_to}
        entry[selection] = work_id
        try:
            validated = CurrentConfig.model_validate(state)
        except ValidationError as error:
            raise click.ClickException(str(error)) from error
        self._write_state(validated)

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
            if config.project.name != name:
                raise click.ClickException(f"{path}: project.name does not match folder '{name}'")
            code = directory / "code"
            if code.is_symlink() or not code.is_dir():
                raise click.ClickException(f"Checkout must be a real directory at {code}")
            if not config.project.path.is_absolute() or config.project.path != code:
                raise click.ClickException(f"{path}: relocate the checkout to {code} and update project.path")
            return ProjectContext(name=name, root=directory, code=code, config=config)

    def names(self) -> list[str]:
        return self.discovery.names()

    def list_projects(self) -> list[ProjectContext]:
        return [self.load(name) for name in self.names()]

    def current_name(self) -> str:
        return self.discovery.require_current(self.state().current_project)

    def current(self) -> ProjectContext:
        return self.load(self.current_name())

    def switch(self, name: str) -> ProjectContext:
        with file_errors():
            project = self.load(name)
            self._check_state()
            self._select(project)
            return project

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
            self._check_state()
            self.root.mkdir(parents=True, exist_ok=True)
            directory.mkdir()
            code = directory / "code"
            try:
                if repository is not None:
                    subprocess.run(["gh", "repo", "clone", repository.url, str(code)], check=True)
                else:
                    code.mkdir()
                config = ProjectConfig(
                    project=ProjectMetadata(name=name, path=code),
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
                self._select(project)
                return project
            except (OSError, subprocess.CalledProcessError, click.ClickException) as error:
                shutil.rmtree(directory)
                if isinstance(error, FileNotFoundError):
                    raise click.ClickException("GitHub CLI 'gh' was not found; install it and run gh auth login.") from error
                if isinstance(error, subprocess.CalledProcessError):
                    raise click.ClickException(f"gh repo clone failed (exit {error.returncode}); current project was not changed.") from error
                raise
