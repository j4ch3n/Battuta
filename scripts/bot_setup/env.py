"""Read and validate setup environment values."""

from pathlib import Path
import shlex

import click


def read_env(path: Path) -> dict[str, str]:
    if not path.is_file():
        raise click.ClickException(f"Missing {path}; create it from .env.example")
    values: dict[str, str] = {}
    for number, line in enumerate(path.read_text().splitlines(), start=1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        key, separator, value = line.partition("=")
        if separator:
            value = value.strip()
            if not value or value.startswith("#"):
                values[key.strip()] = ""
                continue
            # Read one shell-style value. A # within a word or quotes is literal;
            # a comment after the value is ignored without parsing its contents.
            lexer = shlex.shlex(value, posix=True)
            lexer.whitespace_split = True
            lexer.commenters = ""
            try:
                parsed = lexer.get_token() or ""
                trailing = lexer.instream.read().strip()
                if trailing and not trailing.startswith("#"):
                    raise ValueError("Expected a single quoted or unquoted value")
            except ValueError as error:
                raise click.ClickException(f"Invalid environment value in {path}:{number}: {error}") from error
            values[key.strip()] = parsed
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
