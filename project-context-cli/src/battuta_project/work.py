"""Shared role/scope storage, locking and work identity allocation."""

from contextlib import contextmanager
from pathlib import Path
import secrets
import string

import click

from .registry import ProjectRegistry
from .storage import file_lock


class WorkContext:
    def __init__(self, scope: str, role: str, registry: ProjectRegistry | None = None):
        if scope not in ("project", "general"):
            raise click.ClickException("Scope must be project or general")
        if role not in ("pm", "tl"):
            raise click.ClickException("AGENT_ROLE must be pm or tl")
        self.scope = scope
        self.role = role
        self.registry = registry or ProjectRegistry()
        self.project = None
        if scope == "project":
            project = self.registry.current()
            self.project = project.name
            self.directory = project.root / "work"
        else:
            self.directory = Path.home() / ".battuta" / "work"

    @contextmanager
    def locked(self, *, create: bool = False):
        with self.registry.locked(create=create):
            with file_lock(self.directory / f".work-{self.role}.lock", create=create):
                yield

    def new_work_id(self) -> str:
        for _ in range(100):
            work_id = "".join(secrets.choice(string.ascii_lowercase + string.digits) for _ in range(5))
            paths = [self.directory / f"{kind}-{role}-{work_id}.{suffix}"
                     for role in ("pm", "tl") for kind, suffix in (("todo", "jsonl"), ("note", "md"), ("note", "json"))]
            if any(path.exists() or path.is_symlink() for path in paths):
                continue
            if any(self.directory.glob(f"note-*-{work_id}-draft-*.md")):
                continue
            if any(self.registry.work_record(self.project, role, work_id) is not None for role in ("pm", "tl")):
                continue
            return work_id
        raise click.ClickException("Work ID allocation exhausted after 100 collisions")
