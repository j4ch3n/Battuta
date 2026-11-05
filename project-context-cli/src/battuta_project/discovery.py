"""Read-only registry discovery and actionable messages shared by CLI commands."""

from pathlib import Path

import click

from .storage import check_registry_root, file_errors


_INIT_GUIDANCE = "Run battuta-project init <project-name> to initialize and select a project."
_MESSAGES = {
    "missing_store": f"No Battuta project store has been initialized. {_INIT_GUIDANCE}",
    "empty_registry": f"No registered projects. {_INIT_GUIDANCE}",
    "no_current": "No current project is selected. Run battuta-project list, then battuta-project switch <project-name>, or battuta-project init <project-name>.",
    "unknown_project": "Project '{name}' is not registered. Run battuta-project list to see registered projects, or battuta-project init <project-name> to initialize and select a project.",
}


class ProjectDiscovery:
    def __init__(self, root: Path):
        self.root = root

    def names(self) -> list[str]:
        with file_errors():
            check_registry_root(self.root)
            return sorted(p.name for p in self.root.iterdir()
                          if p.is_dir() and not p.is_symlink() and not p.name.startswith(".")) if self.root.is_dir() else []

    def unavailable_message(self, name: str | None = None) -> str:
        with file_errors():
            check_registry_root(self.root)
            if not self.root.is_dir():
                key = "missing_store"
            elif not self.names():
                key = "empty_registry"
            else:
                key = "no_current" if name is None else "unknown_project"
            return _MESSAGES[key].format(name=name)

    def require_project(self, directory: Path, name: str) -> None:
        if not directory.is_dir():
            raise click.ClickException(self.unavailable_message(name))

    def require_current(self, name: str | None) -> str:
        if name is None:
            raise click.ClickException(self.unavailable_message())
        return name
