"""Safely read and atomically write Pi configuration JSON."""

import json
import math
import os
from pathlib import Path
import tempfile

import click


def _finite_number(value: str) -> float:
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("Non-finite JSON number")
    return number


def read_config(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(), parse_constant=_finite_number, parse_float=_finite_number) if path.exists() else {}
    except ValueError as error:
        raise click.ClickException(f"Invalid JSON in {path}") from error
    except OSError as error:
        raise click.ClickException(f"Cannot read {path}") from error
    if not isinstance(data, dict):
        raise click.ClickException(f"Expected a JSON object in {path}")
    return data


def write_config(path: Path, data: dict, prefix: str) -> None:
    try:
        content = json.dumps(data, indent=2, allow_nan=False) + "\n"
    except (ValueError, TypeError) as error:
        raise click.ClickException(f"Invalid JSON data for {path}") from error
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=prefix, dir=path.parent)
    try:
        with os.fdopen(fd, "w") as output:
            output.write(content)
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
