"""Open original files without following symlinks or reopening checked paths."""

import errno
import os
import stat
from pathlib import Path

from starlette.responses import StreamingResponse

from .models import relative_path


def allowed_link_root(project: str | None) -> Path | None:
    """Return the owning project's resolved code checkout, or None when links are not allowed."""
    if project is None:
        return None
    try:
        from battuta_project.registry import ProjectRegistry

        root = ProjectRegistry().load(project).code.resolve(strict=True)
        return root if root.is_dir() else None
    except Exception:
        return None


_DIRECTORY_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
_FILE_FLAGS = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC


def _open_regular(name: str, directory: int):
    descriptor = os.open(name, _FILE_FLAGS, dir_fd=directory)
    try:
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise OSError("Not a regular file")
        return os.fdopen(descriptor, "rb")
    except BaseException:
        os.close(descriptor)
        raise


def _link_target(parent: Path, name: str, directory: int) -> Path:
    """Resolve a leaf link's complete chain relative to its validated parent directory."""
    return Path(os.path.realpath(os.path.join(parent, os.readlink(name, dir_fd=directory))))


def _check_target(target: Path, link_root: Path) -> None:
    if target == link_root or not target.is_relative_to(link_root):
        raise OSError("Link target is outside the project checkout")
    if not stat.S_ISREG(os.lstat(target).st_mode):
        raise OSError("Link target is not a regular file")


def _open_linked(target: Path, link_root: Path):
    _check_target(target, link_root)
    # Reopen by a fresh no-follow walk: a component swapped after resolution fails closed.
    directory = os.open("/", _DIRECTORY_FLAGS)
    try:
        components = target.parts[1:]
        for component in components[:-1]:
            child = os.open(component, _DIRECTORY_FLAGS, dir_fd=directory)
            os.close(directory)
            directory = child
        return _open_regular(components[-1], directory)
    finally:
        os.close(directory)


def open_source(root: str, path: str, *, link_root: Path | None = None):
    relative_path(path)
    source_root = Path(root)
    if not source_root.is_absolute() or ".." in source_root.parts:
        raise OSError("Invalid source root")
    # Walk from / using descriptor-relative opens. No ancestor or leaf symlink
    # can be swapped between validation and open to expose an unchecked file.
    # Only a leaf link into the owning project's checkout is followed, by realpath and a fresh walk.
    directory = os.open("/", _DIRECTORY_FLAGS)
    try:
        components = [*source_root.parts[1:], *path.split("/")]
        for component in components[:-1]:
            child = os.open(component, _DIRECTORY_FLAGS, dir_fd=directory)
            os.close(directory)
            directory = child
        try:
            return _open_regular(components[-1], directory)
        except OSError as exc:
            if link_root is None or exc.errno != errno.ELOOP:
                raise
            parent = Path("/", *components[:-1])
            return _open_linked(_link_target(parent, components[-1], directory), link_root)
    finally:
        os.close(directory)


class SourceResponse(StreamingResponse):
    """Use Starlette streaming while retaining ownership of an already-open file."""

    def __init__(self, source, media_type):
        self.source = source
        super().__init__(iter(lambda: source.read(64 * 1024), b""), media_type=media_type,
                         headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})

    async def __call__(self, scope, receive, send):
        try:
            await super().__call__(scope, receive, send)
        finally:
            self.source.close()
