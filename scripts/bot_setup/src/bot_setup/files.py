"""Small, preflighted file operations shared by source and release setup."""

import os
from pathlib import Path
import tempfile

import click

from .manifest import FileRule


def safe_path(base: Path, relative: str) -> Path:
    if not relative or Path(relative).is_absolute() or ".." in Path(relative).parts:
        raise click.ClickException(f"Expected a relative path beneath {base}")
    target = base / relative
    for path in (target, *target.parents):
        if path.is_symlink():
            raise click.ClickException(f"Refusing symlink path: {path}")
        if path != target and path.exists() and not path.is_dir():
            raise click.ClickException(f"Expected a directory: {path}")
    return target


def prepare_files(root: Path, profile: Path, private: Path, rules: list[FileRule], *, source_profile: Path | None = None) -> None:
    pending = []
    targets = set()
    for rule in rules:
        destination = profile if rule.destination == "profile" else private
        target = safe_path(destination, rule.target)
        if target in targets or (target.exists() and not target.is_file()):
            raise click.ClickException(f"Invalid or duplicate generated file: {target}")
        targets.add(target)
        sources = [safe_path(root if source.root == "repository" else source_profile or profile, source.path) for source in rule.sources]
        if rule.operation == "copy" and len(sources) != 1:
            raise click.ClickException("Copy rules require exactly one source")
        if rule.optional and any(not path.exists() for path in sources):
            continue
        try:
            content = sources[0].read_bytes() if rule.operation == "copy" else "\n".join(path.read_text() for path in sources).encode()
        except OSError as error:
            raise click.ClickException(f"Cannot read setup file: {error.filename}") from error
        pending.append((target, content, rule.policy))
    for target, content, policy in pending:
        target.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
        if policy == "create-only":
            try:
                fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            except FileExistsError:
                continue
            with os.fdopen(fd, "wb") as output:
                output.write(content)
        else:
            fd, temporary = tempfile.mkstemp(prefix=".setup-", dir=target.parent)
            try:
                with os.fdopen(fd, "wb") as output:
                    output.write(content)
                os.replace(temporary, target)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
