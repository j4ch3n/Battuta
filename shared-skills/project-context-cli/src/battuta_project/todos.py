"""Project/general ordered TODO queues, independent of agent sessions."""

from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
import os
from pathlib import Path
import re
import secrets
import string
import tempfile
from typing import Literal

import click
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from .registry import ProjectRegistry
from .storage import atomic_write, file_lock, regular_file
from .todo_errors import TodoError, TodoErrorCode


class TodoItem(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    id: int = Field(ge=1)
    status: Literal["todo", "done", "cancelled"]
    description: str
    rational: str

    @field_validator("description")
    @classmethod
    def nonblank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("description must not be blank")
        return value

    @model_validator(mode="after")
    def explanation_matches_status(self) -> "TodoItem":
        if self.status == "todo" and self.rational != "":
            raise ValueError("rational must be empty for TODO items")
        if self.status != "todo" and not self.rational.strip():
            raise ValueError("done/cancelled items require a nonblank rational explanation")
        return self


@dataclass
class TodoList:
    path: Path
    items: list[TodoItem]
    scope: Literal["project", "general"]
    role: Literal["pm", "tl"]
    project: str | None
    work_id: str | None = None
    related_to: str | None = None


class TodoStore:
    def __init__(self, scope: str, role: str, registry: ProjectRegistry | None = None):
        if scope not in ("project", "general"):
            raise TodoError(TodoErrorCode.INVALID_INPUT)
        if role not in ("pm", "tl"):
            raise TodoError(TodoErrorCode.INVALID_ROLE)
        self.scope = scope
        self.role = role
        self.registry = registry or ProjectRegistry()
        self.project = None
        if scope == "project":
            try:
                project = self.registry.current()
            except click.ClickException as error:
                raise TodoError(TodoErrorCode.PROJECT_UNAVAILABLE, detail=error) from error
            self.project = project.name
            self.directory = project.root / "todos"
        else:
            self.directory = Path.home() / ".battuta" / "todos"

    @contextmanager
    def _locked(self, *, create: bool = False):
        try:
            with self.registry.locked(create=create):
                with file_lock(self.directory / f".todo-{self.role}.lock", create=create):
                    yield
        except (OSError, RuntimeError, click.ClickException) as error:
            raise TodoError(TodoErrorCode.TODO_STORAGE_ERROR, detail=error) from error

    def _latest(self) -> TodoList | None:
        work_id = self.registry.current_work_id(self.project, self.role)
        if work_id is not None:
            path = self.directory / f"todo-{self.role}-{work_id}.jsonl"
            record = self.registry.work_record(self.project, self.role, work_id)
            return self._load(path, work_id, record.related_to)
        if not self.directory.exists():
            return None
        pattern = re.compile(rf"todo-{self.role}-(\d{{8}}T\d{{6}}Z)\.jsonl")
        paths = []
        for path in self.directory.iterdir():
            match = pattern.fullmatch(path.name)
            if match:
                try:
                    datetime.strptime(match[1], "%Y%m%dT%H%M%SZ")
                except ValueError as error:
                    raise TodoError(TodoErrorCode.INVALID_TODO_FILE, path=path, detail=error) from error
                paths.append(path)
        if not paths:
            return None
        path = max(paths)
        return self._load(path)

    def _load(self, path: Path, work_id: str | None = None, related_to: str | None = None) -> TodoList:
        regular_file(path)
        try:
            with path.open(encoding="utf-8") as source:
                items = [TodoItem.model_validate_json(line) for line in source]
            if not items:
                raise ValueError("a persisted TODO list must contain at least one item")
            seen_todo = False
            for index, item in enumerate(items, start=1):
                if item.id != index or (seen_todo and item.status != "todo"):
                    raise ValueError("IDs must be sequential and completed/cancelled items must precede TODO items")
                seen_todo = seen_todo or item.status == "todo"
        except (ValueError, ValidationError, FileNotFoundError) as error:
            raise TodoError(TodoErrorCode.INVALID_TODO_FILE, path=path, detail=error) from error
        return TodoList(path, items, self.scope, self.role, self.project, work_id, related_to)

    def read(self) -> TodoList | None:
        with self._locked():
            return self._latest()

    @staticmethod
    def _new_items(descriptions: list[str], start: int = 1) -> list[TodoItem]:
        if not descriptions:
            raise TodoError(TodoErrorCode.INVALID_INPUT)
        try:
            return [TodoItem(id=index, status="todo", description=text, rational="") for index, text in enumerate(descriptions, start=start)]
        except ValidationError as error:
            raise TodoError(TodoErrorCode.INVALID_INPUT) from error

    @staticmethod
    def _text(items: list[TodoItem]) -> str:
        return "".join(item.model_dump_json() + "\n" for item in items)

    def create(self, descriptions: list[str], *, force: bool = False, related_to: str | None = None) -> TodoList:
        items = self._new_items(descriptions)
        with self._locked(create=True):
            if related_to is not None:
                if not isinstance(related_to, str) or not re.fullmatch(r"(pm|tl):[a-z0-9]{5}", related_to):
                    raise TodoError(TodoErrorCode.INVALID_REFERENCE)
                role, target = related_to.split(":")
                if self.registry.work_record(self.project, role, target) is None:
                    raise TodoError(TodoErrorCode.INVALID_REFERENCE)
            previous = self._latest()
            if previous and not force:
                remaining = [item for item in previous.items if item.status == "todo"]
                if remaining:
                    lines = "\n".join(f"{item.id}. {item.description}" for item in remaining)
                    raise TodoError(
                        TodoErrorCode.UNFINISHED_TODO,
                        filename=previous.path.name,
                        remaining=lines,
                    )
            work_id = self._new_work_id()
            name = f"todo-{self.role}-{work_id}.jsonl"
            path = self.directory / name
            fd, temporary = tempfile.mkstemp(prefix=f".{name}.", dir=self.directory)
            try:
                with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as output:
                    output.write(self._text(items))
                    output.flush()
                    os.fsync(output.fileno())
                try:
                    os.link(temporary, path)
                except FileExistsError as error:
                    raise TodoError(TodoErrorCode.WORK_ID_COLLISION) from error
            finally:
                os.unlink(temporary)
            try:
                self.registry.set_work_id(self.project, self.role, work_id, related_to=related_to)
            except (OSError, RuntimeError, click.ClickException):
                path.unlink()
                raise
            return TodoList(path, items, self.scope, self.role, self.project, work_id, related_to)

    def _new_work_id(self) -> str:
        for _ in range(100):
            work_id = "".join(secrets.choice(string.ascii_lowercase + string.digits) for _ in range(5))
            paths = [self.directory / f"todo-{role}-{work_id}.jsonl" for role in ("pm", "tl")]
            if any(path.exists() or path.is_symlink() for path in paths):
                continue
            if any(self.registry.work_record(self.project, role, work_id) is not None for role in ("pm", "tl")):
                continue
            return work_id
        raise TodoError(TodoErrorCode.WORK_ID_COLLISION)

    def extend(self, descriptions: list[str]) -> TodoList:
        additions = self._new_items(descriptions)
        with self._locked():
            if self.registry.current_work_id(self.project, self.role) is None:
                raise TodoError(TodoErrorCode.NO_CURRENT_WORK)
            current = self._latest()
            for index, item in enumerate(additions, start=len(current.items) + 1):
                item.id = index
            current.items.extend(additions)
            atomic_write(current.path, self._text(current.items))
            return current

    def _unfinished(self) -> tuple[TodoList, int]:
        current = self._latest()
        if current is None:
            raise TodoError(TodoErrorCode.NO_TODO_LIST)
        for index, item in enumerate(current.items):
            if item.status == "todo":
                return current, index
        raise TodoError(TodoErrorCode.NO_NEXT_TODO)

    def advance(self, status: Literal["done", "cancelled"], rational: str) -> TodoList:
        if status not in ("done", "cancelled"):
            raise TodoError(TodoErrorCode.INVALID_INPUT)
        if not isinstance(rational, str) or not rational.strip():
            raise TodoError(TodoErrorCode.INVALID_INPUT)
        with self._locked():
            current, index = self._unfinished()
            current.items[index].status = status
            current.items[index].rational = rational
            atomic_write(current.path, self._text(current.items))
            return current

    def update_todo(self, descriptions: list[str]) -> TodoList:
        replacements = self._new_items(descriptions)
        with self._locked():
            current, index = self._unfinished()
            for offset, item in enumerate(replacements, start=index + 1):
                item.id = offset
            current.items = current.items[:index] + replacements
            atomic_write(current.path, self._text(current.items))
            return current
