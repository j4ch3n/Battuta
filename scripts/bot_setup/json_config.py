"""Safely read and atomically write Pi configuration JSON."""

import json
import os
from pathlib import Path
import tempfile

import click


def read_config(path: Path) -> dict:
    try:
        data = json.loads(path.read_text()) if path.exists() else {}
    except (OSError, json.JSONDecodeError) as error:
        raise click.ClickException(f"Cannot read {path}: {error}") from error
    if not isinstance(data, dict):
        raise click.ClickException(f"Expected a JSON object in {path}")
    return data


def write_config(path: Path, data: dict, prefix: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=prefix, dir=path.parent)
    try:
        with os.fdopen(fd, "w") as output:
            json.dump(data, output, indent=2)
            output.write("\n")
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
