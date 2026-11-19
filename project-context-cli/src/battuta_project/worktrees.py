"""Git worktrees of a project's checkout, kept under the project's managed folder."""

from pathlib import Path
import re
import subprocess

import click

from .models import ProjectContext

NAME = re.compile(r"[a-z0-9]+(-[a-z0-9]+)*")


def _git(directory: Path, *args: str) -> str:
    try:
        result = subprocess.run(["git", "-C", str(directory), *args], capture_output=True, text=True)
    except OSError as error:
        raise click.ClickException(f"git could not run: {error}") from error
    if result.returncode:
        raise click.ClickException(f"git {' '.join(args[:2])} failed: {result.stderr.strip() or result.stdout.strip()}")
    return result.stdout


def worktrees_root(project: ProjectContext) -> Path:
    return project.root / "worktrees"


def _path(project: ProjectContext, name: str) -> Path:
    if not NAME.fullmatch(name):
        raise click.ClickException("Worktree name must be lowercase kebab-case (letters, numbers, single hyphens)")
    return worktrees_root(project) / name


def create(project: ProjectContext, name: str, *, branch: str | None = None, base: str | None = None) -> tuple[Path, str]:
    path = _path(project, name)
    if path.exists():
        raise click.ClickException(f"Worktree already exists: {path}")
    branch = branch or f"agent/{name}"
    worktrees_root(project).mkdir(exist_ok=True)
    _git(project.code, "worktree", "add", "-b", branch, str(path), *([base] if base else []))
    return path, branch


def delete(project: ProjectContext, name: str, *, force: bool = False) -> Path:
    path = _path(project, name)
    if not path.is_dir():
        raise click.ClickException(f"No such worktree: {path}")
    if not force and _git(path, "status", "--porcelain").strip():
        raise click.ClickException(f"Worktree has uncommitted changes: {path}; commit them or pass --force to discard.")
    _git(project.code, "worktree", "remove", "--force", str(path))
    _git(project.code, "worktree", "prune")
    return path


def listing(project: ProjectContext) -> list[dict]:
    """Worktrees under the project's worktrees folder, as `{name, path, branch, dirty}`."""
    found = []
    root = worktrees_root(project).resolve()
    for block in _git(project.code, "worktree", "list", "--porcelain").split("\n\n"):
        fields = dict(line.split(" ", 1) for line in block.splitlines() if " " in line)
        path = Path(fields.get("worktree", "")).resolve()
        if path.parent != root:
            continue
        found.append({
            "name": path.name,
            "path": str(path),
            "branch": fields.get("branch", "(detached)").removeprefix("refs/heads/"),
            "dirty": bool(path.is_dir() and _git(path, "status", "--porcelain").strip()),
        })
    return found
