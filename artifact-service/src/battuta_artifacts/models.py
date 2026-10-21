"""CLI inputs and extension-based artifact assembly (no content inspection)."""

import mimetypes
import re
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .registry import ArtifactError


class Metadata(BaseModel):
    model_config = ConfigDict(extra="forbid")
    slug: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=80)
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=4000)

    @field_validator("title", "description")
    @classmethod
    def not_blank(cls, value):
        if not value.strip():
            raise ValueError("must not be blank")
        return value


def relative_path(value: str) -> str:
    if not value or any(not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_. -]*", part) for part in value.split("/")):
        raise ArtifactError(f"Invalid relative file path: {value}")
    return value


def media_type(path: str) -> str:
    suffix = Path(path).suffix.lower()
    return {".md": "text/markdown", ".markdown": "text/markdown", ".js": "text/javascript",
            ".mjs": "text/javascript", ".css": "text/css", ".html": "text/html",
            ".htm": "text/html"}.get(suffix) or mimetypes.guess_type(path)[0] or "application/octet-stream"


def assemble_files(root: Path | None, entry: str, files: tuple[str, ...]) -> dict:
    if root is None:
        entry_file = Path(entry).expanduser()
        if not entry_file.is_absolute() or files:
            raise ArtifactError("Without --root, provide an absolute --entry and no --file options.")
        root, entry = entry_file.parent, entry_file.name
    root = root.expanduser().absolute()
    # Canonical root is pinned at registration, never re-resolved when serving.
    if root.is_symlink():
        raise ArtifactError("Source root must not be a symlink.")
    root = root.resolve(strict=True)
    entry = relative_path(entry)
    suffix = Path(entry).suffix.lower()
    if suffix not in (".html", ".htm", ".md", ".markdown"):
        raise ArtifactError("Entry extension must be .html, .htm, .md or .markdown.")
    paths = [entry, *files]
    if len(set(paths)) != len(paths):
        raise ArtifactError("Duplicate file paths; the entry is already included automatically.")
    from .files import open_source

    for path in paths:
        relative_path(path)
        try:
            with open_source(str(root), path):
                pass
        except OSError as exc:
            raise ArtifactError(f"File is unavailable: {path}") from exc
    return {"source_root": str(root), "entry_path": entry,
            "format": "markdown" if suffix in (".md", ".markdown") else "html",
            "files": {path: media_type(path) for path in paths}}
