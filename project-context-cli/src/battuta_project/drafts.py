"""Register editable documents; ordinary agent file tools own later edits."""

from datetime import datetime, timezone
import os

import click

from . import notebook_meta
from .notes import NoteStore, _single_line
from .storage import read_text, regular_file


def _document(text: str) -> None:
    if not isinstance(text, str) or not text.strip() or "\x00" in text:
        raise click.ClickException("Expected nonblank UTF-8 draft content without NUL")
    try:
        text.encode("utf-8")
    except UnicodeError as error:
        raise click.ClickException(f"Invalid UTF-8 draft: {error}") from error


class DraftStore:
    def __init__(self, notes: NoteStore):
        self.notes = notes

    def create(self, title: str, text: str):
        _single_line(title)
        _document(text)
        with self.notes._locked(create=True):
            notebook = self.notes._current()
            if notebook is None:
                notebook = self.notes._initialize()
            # Validate published item state without loading it into the draft body.
            for _ in self.notes._lines(notebook.path):
                pass
            index = notebook_meta.load(notebook)
            identifier = index["nextDraftId"]
            path = notebook.path.parent / f"{notebook.path.stem}-draft-{identifier}.md"
            while path.exists() or path.is_symlink():
                identifier += 1
                path = notebook.path.parent / f"{notebook.path.stem}-draft-{identifier}.md"
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            try:
                with os.fdopen(fd, "wb") as output:
                    output.write(text.encode("utf-8"))
                    output.flush()
                    os.fsync(output.fileno())
                draft = {"id": identifier, "title": title, "file": path.name,
                         "createdAt": datetime.now(timezone.utc).isoformat()}
                index["drafts"].append(draft)
                index["nextDraftId"] = identifier + 1
                notebook_meta.save(notebook, index)
            except (OSError, RuntimeError, click.ClickException) as error:
                raise click.ClickException(
                    f"Draft creation failed; retained unregistered file at {path}. "
                    f"Inspect it and draft --list before retrying: {error}"
                ) from error
            return notebook, draft

    def listing(self):
        with self.notes._locked():
            result = self.notes._metadata()
            if result is None:
                return None
            notebook, index = result
            rows = []
            for draft in index["drafts"]:
                path = notebook.path.parent / draft["file"]
                regular_file(path)
                try:
                    path.stat()
                    availability = "available"
                except FileNotFoundError:
                    availability = "missing"
                rows.append({**draft, "path": path, "availability": availability})
            return notebook, rows

    def get(self, identifier: int) -> str:
        if type(identifier) is not int or identifier < 1:
            raise click.ClickException("Draft ID must be a positive integer")
        with self.notes._locked():
            result = self.notes._metadata()
            if result is not None:
                notebook, index = result
                for draft in index["drafts"]:
                    if draft["id"] != identifier:
                        continue
                    path = notebook.path.parent / draft["file"]
                    try:
                        text = read_text(path)
                    except FileNotFoundError as error:
                        raise click.ClickException(
                            f"Draft {identifier} ({draft['title']!r}) is registered, but its file is missing at {path}. "
                            "The reference has been retained; no content was returned."
                        ) from error
                    _document(text)
                    return text
            raise click.ClickException(f"Unknown draft ID: {identifier}")
