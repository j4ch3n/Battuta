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


def write_file(target: Path, content: bytes, *, policy: str) -> bool:
    safe_path(target.parent, target.name)
    if target.exists() and not target.is_file():
        raise click.ClickException(f"Expected a regular setup file: {target}")
    temporary = None
    try:
        target.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix=".setup-", dir=target.parent)
        with os.fdopen(fd, "wb") as output:
            output.write(content)
        if policy == "replace":
            os.replace(temporary, target)
        else:
            # Publish complete bytes without replacing a concurrent creator's file.
            try:
                os.link(temporary, target, follow_symlinks=False)
            except FileExistsError:
                safe_path(target.parent, target.name)
                if not target.is_file():
                    raise click.ClickException(f"Expected a regular setup file: {target}")
                return False
        return True
    except OSError as error:
        raise click.ClickException(f"Cannot write setup file: {target}") from error
    finally:
        if temporary is not None and os.path.exists(temporary):
            os.unlink(temporary)


def prepare_files(root: Path, profile: Path, private: Path, rules: list[FileRule], *, source_profile: Path | None = None, context: str = "source") -> list[tuple[Path, bool]]:
    pending = []
    results = []
    targets = set()
    for rule in rules:
        if rule.context not in {"all", context}:
            continue
        destination = profile if rule.destination == "profile" else private
        target = safe_path(destination, rule.target)
        if target in targets or (target.exists() and not target.is_file()):
            raise click.ClickException(f"Invalid or duplicate generated file: {target}")
        targets.add(target)
        if rule.policy == "create-only" and target.exists():
            results.append((target, False))
            continue
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
        results.append((target, write_file(target, content, policy=policy)))
    return results
