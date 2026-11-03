"""Append-only, numbered working notes with independent notebook identity."""

from contextlib import contextmanager
from dataclasses import dataclass, field
import json
import os
from pathlib import Path
import stat
import subprocess

import click

from .registry import ProjectRegistry
from . import notebook_meta
from .storage import file_errors, regular_file
from .work import WorkContext


@dataclass
class NoteLine:
    number: int
    text: str


@dataclass
class Notebook:
    path: Path
    scope: str
    role: str
    project: str | None
    work_id: str
    lines: list[NoteLine] = field(default_factory=list)
    next_line: int | None = None


def _single_line(text: str) -> None:
    if not isinstance(text, str) or not text.strip() or any(char in text for char in "\x00\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029"):
        raise click.ClickException("Expected nonblank text on one physical line (no NUL or line separators)")
    try:
        text.encode("utf-8")
    except UnicodeError as error:
        raise click.ClickException(f"Expected valid UTF-8 text: {error}") from error


def _range(from_line: int, to_line: int | None = None, limit: int | None = None) -> None:
    if from_line < 1 or (to_line is not None and to_line < from_line) or (limit is not None and limit < 1):
        raise click.ClickException("Line numbers and limits must be positive; end must not precede start")


class NoteStore:
    def __init__(self, scope: str, role: str, registry: ProjectRegistry | None = None):
        self.work = WorkContext(scope, role, registry)

    @contextmanager
    def _locked(self, *, create: bool = False):
        with file_errors():
            try:
                with self.work.locked(create=create):
                    yield
            except UnicodeError as error:
                raise click.ClickException(f"Invalid UTF-8 notebook: {error}") from error

    def _notebook(self, work_id: str) -> Notebook:
        work = self.work
        return Notebook(work.directory / f"note-{work.role}-{work_id}.md", work.scope, work.role, work.project, work_id)

    def _current(self) -> Notebook | None:
        work_id = self.work.registry.current_note_work_id(self.work.project, self.work.role)
        if work_id is None:
            return None
        result = self._notebook(work_id)
        notebook_meta.load(result)
        return result

    def metadata(self) -> tuple[Notebook, dict] | None:
        with self._locked():
            return self._metadata()

    def _metadata(self) -> tuple[Notebook, dict] | None:
        result = self._current()
        if result is None:
            return None
        result.lines = list(self._lines(result.path))
        return result, notebook_meta.load(result)

    def _initialize(self) -> Notebook:
        """Publish an empty notebook under the caller's notebook lock."""
        result = self._notebook(self.work.new_work_id())
        fd = os.open(result.path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "wb") as output:
            output.flush()
            os.fsync(output.fileno())
        try:
            notebook_meta.save(result, notebook_meta.load(result))
            self.work.registry.set_note_work_id(self.work.project, self.work.role, result.work_id)
        except (OSError, RuntimeError, click.ClickException):
            result.path.unlink()
            result.path.with_suffix(".json").unlink(missing_ok=True)
            raise
        return result

    @staticmethod
    def _lines(path: Path):
        regular_file(path)
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, "r", encoding="utf-8", newline="") as source:
            if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
                raise click.ClickException(f"Expected a regular notebook: {path}")
            for number, text in enumerate(source, 1):
                if not text.endswith("\n"):
                    raise click.ClickException(f"Incomplete final notebook line at {path}:{number}; recover it before appending")
                text = text[:-1]
                _single_line(text)
                yield NoteLine(number, text)

    def append(self, text: str) -> Notebook:
        _single_line(text)
        with self._locked(create=True):
            result = self._current()
            if result is None:
                result = self._initialize()
            number = sum(1 for _ in self._lines(result.path)) + 1
            notebook_meta.save(result, notebook_meta.load(result))
            flags = os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW | os.O_NONBLOCK
            fd = os.open(result.path, flags, 0o600)
            with os.fdopen(fd, "wb") as output:
                if not stat.S_ISREG(os.fstat(output.fileno()).st_mode):
                    raise click.ClickException(f"Expected a regular notebook: {result.path}")
                output.write((text + "\n").encode("utf-8"))
                output.flush()
                os.fsync(output.fileno())
            result.lines = [NoteLine(number, text)]
            return result

    @staticmethod
    def _select(result: Notebook, lines, from_line: int, to_line: int | None, limit: int | None) -> Notebook:
        for line in lines:
            if line.number < from_line or (to_line is not None and line.number > to_line):
                continue
            if limit is None or len(result.lines) < limit:
                result.lines.append(line)
            elif result.next_line is None:
                result.next_line = line.number
        return result

    def read(self, *, from_line: int = 1, to_line: int | None = None, limit: int | None = None) -> Notebook | None:
        _range(from_line, to_line, limit)
        with self._locked():
            result = self._current()
            if result is None:
                return None
            return self._select(result, self._lines(result.path), from_line, to_line, limit)

    def search(self, query: str, *, from_line: int = 1, limit: int | None = None) -> Notebook | None:
        _single_line(query)
        _range(from_line, limit=limit)
        with self._locked():
            result = self._current()
            if result is None:
                return None
            # Validate the same file contract as read/append before handing it to rg.
            for _ in self._lines(result.path):
                pass
            try:
                output = subprocess.run([
                    "rg", "--no-config", "--json", "--fixed-strings", "--ignore-case", "--text", "--encoding", "none",
                    "-e", query, "--", str(result.path),
                ], capture_output=True, text=True, encoding="utf-8")
            except FileNotFoundError as error:
                raise click.ClickException("Notebook search requires ripgrep (rg) on PATH; install it and retry") from error
            if output.returncode == 1:
                return result
            if output.returncode != 0:
                raise click.ClickException(f"ripgrep search failed (exit {output.returncode}): {output.stderr.strip()}")
            try:
                def matches():
                    for record in output.stdout.splitlines():
                        event = json.loads(record)
                        if event["type"] != "match":
                            continue
                        data = event["data"]
                        number, text = data["line_number"], data["lines"]["text"]
                        if type(number) is not int or number < 1 or not isinstance(text, str) or not text.endswith("\n"):
                            raise ValueError("invalid numbered match")
                        _single_line(text[:-1])
                        yield NoteLine(number, text[:-1])
                return self._select(result, matches(), from_line, None, limit)
            except (ValueError, KeyError, TypeError) as error:
                raise click.ClickException(f"Invalid ripgrep search output: {error}") from error
