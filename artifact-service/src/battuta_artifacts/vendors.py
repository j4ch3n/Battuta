"""Pinned browser-module catalog for generated artifact starters."""

import json
import re
from functools import cache
from pathlib import Path
from pathlib import PurePosixPath
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
    requires: tuple[str, ...] = ()
    source: str = Field(min_length=1)
    style: str = Field(min_length=1)
    licenses: tuple[str, ...] = Field(min_length=1)

    @staticmethod
    def _https_url(value: str) -> str:
        parsed = urlparse(value)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("URLs require HTTPS hosts without credentials")
        if not re.search(r"@[0-9]+(?:\.[0-9]+)+(?:[-+][0-9A-Za-z.-]+)?(?:/|$)", parsed.path):
            raise ValueError("URLs must use a pinned version")
        return value

    @field_validator("imports", "dependencies", mode="after")
    @classmethod
    def validate_imports(cls, value):
        for name, url in value.items():
            if not name:
                raise ValueError("import mappings require names")
            cls._https_url(url)
            if name.endswith("/") != url.endswith("/"):
                raise ValueError("import mapping prefixes must both end in /")
        return value

    @field_validator("stylesheets")
    @classmethod
    def validate_stylesheets(cls, value):
        for url in value:
            cls._https_url(url)
        return value

    @field_validator("source")
    @classmethod
    def validate_source(cls, value):
        parsed = urlparse(value)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("source requires an HTTPS host without credentials")
        return value

    @field_validator("style")
    @classmethod
    def validate_style(cls, value):
        value = cls._resource_path(value)
        if not value.startswith("styles/") or not value.endswith(".css"):
            raise ValueError("style resources must be CSS files under styles/")
        return value

    @field_validator("licenses")
    @classmethod
    def validate_licenses(cls, value):
        paths = tuple(cls._resource_path(path) for path in value)
        if any(not path.startswith("licenses/") for path in paths):
            raise ValueError("license resources must be under licenses/")
        return paths

    @staticmethod
    def _resource_path(value: str) -> str:
        path = PurePosixPath(value)
        if not value or "\\" in value or path.is_absolute() or ".." in path.parts or str(path) != value:
            raise ValueError("resources require safe package-relative paths")
        return value

    @model_validator(mode="after")
    def unique_import_names(self):
        if self.imports.keys() & self.dependencies.keys():
            raise ValueError("public and dependency import names must not overlap")
        if self.name in self.requires:
            raise ValueError("vendors cannot require themselves")
        return self

    def summary(self, *, selected: bool = True):
        return {
            "name": self.name,
            "purpose": self.purpose,
            "imports": list(self.imports),
            "stylesheets": [f"vendor/{self.name}.css"],
            "selected": selected,
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
    catalog = load_vendors()
    by_name = {vendor.name: vendor for vendor in catalog}
    unknown = set(names) - by_name.keys()
    if unknown:
        raise ArtifactError(f"Unknown vendor: {sorted(unknown)[0]}.")
    resolved = set()
    resolving = set()

    def resolve(name: str):
        if name in resolving:
            raise ArtifactError(f"Vendor catalog has cyclic requirement: {name}.")
        if name in resolved:
            return
        vendor = by_name[name]
        resolving.add(name)
        for requirement in vendor.requires:
            if requirement not in by_name:
                raise ArtifactError(f"Vendor {name} requires unknown vendor: {requirement}.")
            resolve(requirement)
        resolving.remove(name)
        resolved.add(name)

    for name in names:
        resolve(name)
    return tuple(vendor for vendor in catalog if vendor.name in resolved)


def import_map(vendors: tuple[Vendor, ...]) -> dict[str, dict[str, str]]:
    imports = {}
    for vendor in vendors:
        for name, url in {**vendor.imports, **vendor.dependencies}.items():
            previous = imports.setdefault(name, url)
            if previous != url:
                raise ArtifactError(f"Vendor catalog has conflicting import mapping for {name}.")
    return {"imports": imports}
