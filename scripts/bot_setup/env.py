"""Read and validate setup environment values."""

from pathlib import Path

import click


def read_env(path: Path) -> dict[str, str]:
    if not path.is_file():
        raise click.ClickException(f"Missing {path}; create it from .env.example")
    values: dict[str, str] = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        key, separator, value = line.partition("=")
        if separator:
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            values[key.strip()] = value
    return values


def required(values: dict[str, str], name: str, path: Path) -> str:
    value = values.get(name, "").strip()
    if not value or value.startswith("#"):
        raise click.ClickException(f"Set {name} in {path}")
    return value


def positive_id(value: str, name: str, path: Path) -> int:
    if not value.isascii() or not value.isdecimal() or int(value) == 0:
        raise click.ClickException(f"{name} must be a positive integer in {path}")
    return int(value)
