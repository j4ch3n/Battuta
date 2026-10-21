"""Open original files without following symlinks or reopening checked paths."""

import os
import stat
from pathlib import Path

from starlette.responses import StreamingResponse

from .models import relative_path


def open_source(root: str, path: str):
    relative_path(path)
    source_root = Path(root)
    if not source_root.is_absolute() or ".." in source_root.parts:
        raise OSError("Invalid source root")
    # Walk from / using descriptor-relative opens. No ancestor or leaf symlink
    # can be swapped between validation and open to expose an unchecked file.
    directory_flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
    directory = os.open("/", directory_flags)
    try:
        components = [*source_root.parts[1:], *path.split("/")]
        for component in components[:-1]:
            child = os.open(component, directory_flags, dir_fd=directory)
            os.close(directory)
            directory = child
        descriptor = os.open(components[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC,
                             dir_fd=directory)
        try:
            if not stat.S_ISREG(os.fstat(descriptor).st_mode):
                raise OSError("Not a regular file")
            return os.fdopen(descriptor, "rb")
        except BaseException:
            os.close(descriptor)
            raise
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
