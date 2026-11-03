"""Discover repository guidance and render a bounded checkout tree."""

import os
from pathlib import Path

import click

from .models import CheckoutEntry, Explanation, ProjectContext
from .storage import check_registry_root, file_errors, regular_file


EXCLUDED_DIRECTORIES = frozenset({
    ".git", ".venv", "venv", "node_modules", "vendor", "dist", "build",
    ".next", ".nuxt", ".cache", ".pytest_cache", ".mypy_cache",
    ".ruff_cache", ".tox", "__pycache__",
})


def _walk_error(error: OSError) -> None:
    raise error


def _entries(root: Path) -> list[CheckoutEntry]:
    entries = []
    for current, directories, files in os.walk(root, followlinks=False, onerror=_walk_error):
        directory = Path(current)
        directories[:] = sorted(name for name in directories
                                if name not in EXCLUDED_DIRECTORIES and not (directory / name).is_symlink())
        for name, is_directory in [(name, True) for name in directories] + [(name, False) for name in sorted(files)]:
            path = directory / name
            if path.is_symlink() or (not is_directory and not path.is_file()):
                continue
            entries.append(CheckoutEntry(path=path.relative_to(root).as_posix(), is_directory=is_directory))
    return entries


def _tree(entries: list[CheckoutEntry]) -> list[str]:
    children: dict[str, list[CheckoutEntry]] = {}
    for entry in entries:
        parent = str(Path(entry.path).parent)
        children.setdefault(parent, []).append(entry)
    lines = ["code/"]

    def visit(parent: str, prefix: str, depth: int):
        if depth >= 2:
            return
        siblings = sorted(children.get(parent, []), key=lambda entry: entry.path)
        for index, entry in enumerate(siblings):
            last = index == len(siblings) - 1
            lines.append(prefix + ("`-- " if last else "|-- ") + Path(entry.path).name + ("/" if entry.is_directory else ""))
            if entry.is_directory:
                visit(entry.path, prefix + ("    " if last else "|   "), depth + 1)

    visit(".", "", 0)
    return lines


def explain_project(project: ProjectContext) -> Explanation:
    with file_errors():
        check_registry_root(project.root.parent)
        if project.root.is_symlink() or project.code.is_symlink() or not project.code.is_dir():
            raise click.ClickException(f"Checkout must be a real directory: {project.code}")
        summary_path = project.root / "SUMMARY.md"
        regular_file(summary_path)
        try:
            summary = summary_path.read_text(encoding="utf-8") if summary_path.exists() else ""
        except (OSError, UnicodeError) as error:
            raise click.ClickException(f"{summary_path}: {error}") from error
        entries = _entries(project.code)
        documents = {entry.path for entry in entries if not entry.is_directory}
        repository = project.config.github.repository
        return Explanation(
            project=project.name, root=project.code,
            managed_root=project.root,
            summary_path=summary_path, summary=summary if summary.strip() else None,
            repository_url=f"https://github.com/{repository}" if repository else None,
            readme="README.md" if "README.md" in documents else None,
            agents="AGENTS.md" if "AGENTS.md" in documents else None,
            sub_readmes=sorted(path for path in documents if path.endswith("/README.md")),
            sub_agents=sorted(path for path in documents if path.endswith("/AGENTS.md")),
            tree=_tree(entries),
        )
