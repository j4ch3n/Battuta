"""Explicit indexed edits to a project's durable line-oriented memory."""

import click

from .models import MemoryEntry, ProjectContext
from .storage import atomic_write, check_registry_root, file_errors, regular_file


def single_line(content: str) -> str:
    if len(content.splitlines()) != 1 or any(char in content for char in "\r\n"):
        raise click.ClickException("Content must be one non-empty line; use memory replaceAll for multiline content.")
    clean = content.strip()
    if not clean:
        raise click.ClickException("Memory content must not be empty.")
    return clean


class ProjectMemory:
    def __init__(self, project: ProjectContext):
        self.project = project

    @property
    def path(self):
        check_registry_root(self.project.root.parent)
        if self.project.root.is_symlink() or not self.project.root.is_dir():
            raise click.ClickException(f"Project root must be a real directory: {self.project.root}")
        path = self.project.root / "MEMORY.md"
        regular_file(path)
        return path

    def get(self) -> list[MemoryEntry]:
        with file_errors():
            path = self.path
            content = path.read_text(encoding="utf-8") if path.exists() else ""
            return [MemoryEntry(index=index, content=line) for index, line in enumerate(content.splitlines(), 1)]

    def _write(self, lines: list[str]) -> None:
        atomic_write(self.path, "\n".join(lines) + ("\n" if lines else ""))

    def append(self, content: str) -> int:
        line = single_line(content)
        lines = [entry.content for entry in self.get()]
        lines.append(line)
        self._write(lines)
        return len(lines)

    def replace(self, index: int, content: str) -> None:
        line = single_line(content)
        lines = [entry.content for entry in self.get()]
        if not 1 <= index <= len(lines):
            raise click.ClickException(f"Memory line index must be between 1 and {len(lines)}; received {index}.")
        lines[index - 1] = line
        self._write(lines)

    def replace_all(self, content: str) -> int:
        lines = [clean for line in content.splitlines() if (clean := line.strip())]
        self._write(lines)
        return len(lines)
