"""Atomic text persistence and readable filesystem failures."""

from contextlib import contextmanager
import os
from pathlib import Path
import tempfile

import click


@contextmanager
def file_errors():
    try:
        yield
    except (OSError, RuntimeError) as error:
        raise click.ClickException(str(error)) from error


def regular_file(path: Path) -> None:
    if path.is_symlink():
        raise click.ClickException(f"File must not be a symlink: {path}")
    if path.exists() and not path.is_file():
        raise click.ClickException(f"Expected a regular file: {path}")


def check_registry_root(root: Path) -> None:
    """Check the owned registry and its parent without rejecting OS/home aliases."""
    for directory in (root.parent, root):
        if directory.is_symlink():
            raise click.ClickException(f"Registry directory must not be a symlink: {directory}")
        if directory.exists() and not directory.is_dir():
            raise click.ClickException(f"Expected a registry directory: {directory}")


def atomic_write(path: Path, text: str) -> None:
    """Replace one owned file without exposing a partially written document."""
    with file_errors():
        regular_file(path)
        fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as output:
                output.write(text)
                output.flush()
                os.fsync(output.fileno())
            regular_file(path)
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
