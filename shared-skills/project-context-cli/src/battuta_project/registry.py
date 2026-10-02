"""GitHub checkout initialization and persisted current-project selection."""

from pathlib import Path
import shutil
import subprocess

import click
from pydantic import ValidationError
import yaml

from .models import CurrentConfig, GithubConfig, ProjectConfig, ProjectContext, ProjectMetadata, Repository, project_name
from .storage import atomic_write, check_registry_root, file_errors, regular_file


class ProjectRegistry:
    def __init__(self, root: Path | None = None):
        self.root = (root or Path.home() / ".battuta" / "projects").expanduser().absolute()

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

    def _state(self) -> CurrentConfig:
        with file_errors():
            check_registry_root(self.root)
            regular_file(self.state_path)
            if not self.state_path.exists():
                raise click.ClickException("No current project. Run battuta-project init <github-url> or switch <project-name>.")
            try:
                return CurrentConfig.model_validate_json(self.state_path.read_text(encoding="utf-8"))
            except ValidationError as error:
                raise click.ClickException(f"{self.state_path}: {error}") from error

    def _check_state(self) -> None:
        check_registry_root(self.root)
        regular_file(self.state_path)
        if self.state_path.exists():
            self._state()

    def _select(self, project: ProjectContext) -> None:
        state = CurrentConfig(currentProject=project.name)
        atomic_write(self.state_path, state.model_dump_json(by_alias=True, indent=2) + "\n")

    def load(self, name: str) -> ProjectContext:
        with file_errors():
            directory = self._directory(name)
            if not directory.is_dir():
                available = sorted(p.name for p in self.root.iterdir()
                                   if p.is_dir() and not p.is_symlink() and not p.name.startswith(".")) if self.root.is_dir() else []
                raise click.ClickException(
                    f"Project '{name}' was not found under {self.root}.\n"
                    f"Available projects: {', '.join(available) or 'none'}"
                )
            path = directory / "project.yaml"
            regular_file(path)
            try:
                config = ProjectConfig.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")))
            except (ValidationError, yaml.YAMLError) as error:
                raise click.ClickException(f"{path}: {error}") from error
            if config.project.name != name:
                raise click.ClickException(f"{path}: project.name does not match folder '{name}'")
            code = directory / "code"
            if code.is_symlink() or not code.is_dir():
                raise click.ClickException(f"Checkout must be a real directory at {code}")
            if not config.project.path.is_absolute() or config.project.path != code:
                raise click.ClickException(f"{path}: relocate the checkout to {code} and update project.path")
            return ProjectContext(name=name, root=directory, code=code, config=config)

    def current(self) -> ProjectContext:
        return self.load(self._state().current_project)

    def switch(self, name: str) -> ProjectContext:
        with file_errors():
            project = self.load(name)
            self._check_state()
            self._select(project)
            return project

    def init(self, url: str) -> ProjectContext:
        try:
            repository = Repository.from_url(url)
        except ValueError as error:
            raise click.ClickException(str(error)) from error
        with file_errors():
            directory = self._directory(repository.name)
            if directory.exists():
                raise click.ClickException(f"Project directory already exists: {directory}")
            self._check_state()
            self.root.mkdir(parents=True, exist_ok=True)
            directory.mkdir()
            code = directory / "code"
            try:
                subprocess.run(["gh", "repo", "clone", repository.url, str(code)], check=True)
                config = ProjectConfig(
                    project=ProjectMetadata(name=repository.name, path=code),
                    github=GithubConfig(repository=f"{repository.owner}/{repository.name}"),
                )
                atomic_write(directory / "project.yaml", yaml.safe_dump(config.model_dump(mode="json"), sort_keys=False))
                project = self.load(repository.name)
                self._select(project)
                return project
            except (OSError, subprocess.CalledProcessError, click.ClickException) as error:
                shutil.rmtree(directory)
                if isinstance(error, FileNotFoundError):
                    raise click.ClickException("GitHub CLI 'gh' was not found; install it and run gh auth login.") from error
                if isinstance(error, subprocess.CalledProcessError):
                    raise click.ClickException(f"gh repo clone failed (exit {error.returncode}); current project was not changed.") from error
                raise
