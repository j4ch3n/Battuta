"""Read-only registry discovery and actionable messages shared by CLI commands."""

from pathlib import Path

import click

from .storage import check_registry_root, file_errors, regular_file


_INIT_GUIDANCE = "Run battuta-project init <project-name> to initialize a project."
_MESSAGES = {
    "missing_store": f"No Battuta project store has been initialized. {_INIT_GUIDANCE}",
    "empty_registry": f"No registered projects. {_INIT_GUIDANCE}",
    "unknown_project": "Project '{name}' is not registered. Run battuta-project list to see registered projects, or battuta-project init <project-name> to initialize a project.",
}


class ProjectDiscovery:
    def __init__(self, root: Path):
        self.root = root

    def names(self) -> list[str]:
        with file_errors():
            check_registry_root(self.root)
            return sorted(p.name for p in self.root.iterdir()
                          if p.is_dir() and not p.is_symlink() and not p.name.startswith(".")
                          and self._registered(p)) if self.root.is_dir() else []

    @staticmethod
    def _registered(directory: Path) -> bool:
        marker = directory / "project.yaml"
        regular_file(marker)
        return marker.is_file()

    def unavailable_message(self, name: str | None = None) -> str:
        with file_errors():
            check_registry_root(self.root)
            if not self.root.is_dir():
                key = "missing_store"
            elif not self.names():
                key = "empty_registry"
            else:
                key = "unknown_project"
            return _MESSAGES[key].format(name=name)

    def require_project(self, directory: Path, name: str) -> None:
        if (not directory.is_dir()
                or not any(entry.name == name for entry in self.root.iterdir())
                or not self._registered(directory)):
            raise click.ClickException(self.unavailable_message(name))
