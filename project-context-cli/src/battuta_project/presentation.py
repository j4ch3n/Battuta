"""Jinja presentation from validated command models and packaged templates."""

from pathlib import Path

from jinja2 import Environment, PackageLoader, StrictUndefined
from pydantic import BaseModel


def display_path(value: Path) -> str:
    path = Path(value)
    try:
        return "~/" + path.relative_to(Path.home()).as_posix()
    except ValueError:
        return str(path)


def render(template: str, model: BaseModel) -> str:
    environment = Environment(
        loader=PackageLoader("battuta_project", "templates"),
        undefined=StrictUndefined, autoescape=False,
        trim_blocks=True, lstrip_blocks=True,
    )
    environment.filters["display_path"] = display_path
    return environment.get_template(template).render(**model.model_dump()).rstrip()
