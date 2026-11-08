"""Pinned browser-module catalog for generated artifact starters."""

import json
from functools import cache
from pathlib import Path
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .registry import ArtifactError


class Vendor(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(pattern=r"^[a-z][a-z0-9-]*$")
    version: str = Field(min_length=1)
    purpose: str = Field(min_length=1)
    imports: dict[str, str] = Field(default_factory=dict)
    dependencies: dict[str, str] = Field(default_factory=dict)
    stylesheets: list[str] = Field(default_factory=list)

    @field_validator("imports", "dependencies", mode="after")
    @classmethod
    def validate_imports(cls, value):
        for name, url in value.items():
            if not name or not urlparse(url).scheme == "https":
                raise ValueError("import mappings require HTTPS URLs")
            if name.endswith("/") != url.endswith("/"):
                raise ValueError("import mapping prefixes must both end in /")
        return value

    @field_validator("stylesheets")
    @classmethod
    def validate_stylesheets(cls, value):
        if any(urlparse(url).scheme != "https" for url in value):
            raise ValueError("stylesheets require HTTPS URLs")
        return value

    @model_validator(mode="after")
    def unique_import_names(self):
        if self.imports.keys() & self.dependencies.keys():
            raise ValueError("public and dependency import names must not overlap")
        return self

    def summary(self):
        return {
            "name": self.name,
            "purpose": self.purpose,
            "imports": list(self.imports),
            "stylesheets": self.stylesheets,
        }


@cache
def load_vendors() -> tuple[Vendor, ...]:
    path = Path(__file__).parent / "authoring/vendors.json"
    try:
        entries = json.loads(path.read_text())
        vendors = tuple(Vendor.model_validate(entry) for entry in entries)
    except (OSError, ValueError) as exc:
        raise ArtifactError("Vendor catalog is unavailable.") from exc
    if len({vendor.name for vendor in vendors}) != len(vendors):
        raise ArtifactError("Vendor catalog contains duplicate names.")
    return vendors


def select_vendors(names: tuple[str, ...]) -> tuple[Vendor, ...]:
    by_name = {vendor.name: vendor for vendor in load_vendors()}
    unknown = set(names) - by_name.keys()
    if unknown:
        raise ArtifactError(f"Unknown vendor: {sorted(unknown)[0]}.")
    selected = set(names)
    return tuple(vendor for vendor in load_vendors() if vendor.name in selected)


def import_map(vendors: tuple[Vendor, ...]) -> dict[str, dict[str, str]]:
    imports = {}
    for vendor in vendors:
        for name, url in {**vendor.imports, **vendor.dependencies}.items():
            previous = imports.setdefault(name, url)
            if previous != url:
                raise ArtifactError(f"Vendor catalog has conflicting import mapping for {name}.")
    return {"imports": imports}
