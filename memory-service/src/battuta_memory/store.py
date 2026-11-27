"""The library store with Battuta's write rules: catalog projects, unique names, wrapper-only overviews.

Every write and every check (including the toolkit subprocess's) passes through ``_prepare``.
"""
import contextlib
import dataclasses
import json
from pathlib import Path

from agent_memory.core import placement
from agent_memory.core.errors import FieldError, ValidationError
from agent_memory.core.store import Store

from . import query_terms  # noqa: F401  (keyword queries drop stopwords)
from . import query_terms  # noqa: F401  (keyword queries drop stopwords)
from .layout import OVERVIEW

CATALOG_FILE = ".state/battuta-catalog.json"
GLOBAL = "global"


def catalog_path(root: Path) -> Path:
    return Path(root) / CATALOG_FILE


def write_catalog(root: Path, projects: list[str]) -> list[str]:
    """Snapshot the project catalog; two names that share a folder segment would merge two projects."""
    from agent_memory.core.config import Config
    config = Config.load(Path(root))
    names = sorted({*projects, GLOBAL})
    segments: dict[str, str] = {}
    for name in names:
        segment = placement.portable_segment(name, config)
        if not segment or segment in segments:
            raise ValueError(f"Project names collide or have no folder segment: {segments.get(segment, name)!r}, {name!r}")
        segments[segment] = name
    path = catalog_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    staged = path.with_suffix(".tmp")
    staged.write_text(json.dumps(names) + "\n", encoding="utf-8")
    staged.replace(path)
    return names


def project_of(record) -> str:
    return str(record.fields.get("project", ""))


class DistillSchemas:
    """What the distill model sees: conversation types only, each naming the valid projects."""

    def __init__(self, store):
        self._store = store
        self._registry = store.schemas

    def all(self):
        projects = ", ".join(self._store.catalog())
        guidance = (f" Set fields.project to one of: {projects}; owner-personal memories use global."
                    " When the owner or CoS declares entries stale or superseded, write each entry's exact slug verbatim in the body.")
        return [dataclasses.replace(schema, description=schema.description + guidance) for schema in self._registry.all() if schema.type != OVERVIEW]

    def __getattr__(self, name):
        return getattr(self._registry, name)


class BattutaStore(Store):
    def __init__(self, root, *, distill_view: bool = False, **kwargs):
        kwargs.setdefault("agent", "battuta")
        super().__init__(root, **kwargs)
        self._overview_writes = False
        if distill_view:
            self.schemas = DistillSchemas(self)

    def catalog(self) -> list[str]:
        try:
            return json.loads(catalog_path(self.root).read_text(encoding="utf-8"))
        except FileNotFoundError:
            return [GLOBAL]

    def segment(self, project: str) -> str:
        return placement.portable_segment(project, self.config)

    @contextlib.contextmanager
    def overview_writes(self):
        self._overview_writes = True
        try:
            yield self
        finally:
            self._overview_writes = False

    def _prepare(self, spec, *, archive_excerpts):
        kind = str(spec.get("type") or "")
        if kind == OVERVIEW and not self._overview_writes:
            raise ValidationError([FieldError("type", "overview memories are written only by the overview refresh")])
        fields = spec.get("fields") if isinstance(spec.get("fields"), dict) else {}
        project = str(fields.get("project") or "").strip()
        catalog = self.catalog()
        if not project or self.segment(project) not in {self.segment(name) for name in catalog}:
            raise ValidationError([FieldError("project", f"{project or '(missing)'} is not a known project; projects: {', '.join(catalog)}")])
        spec = {**spec, "fields": {**fields, "project": self.segment(project)}}
        if not spec.get("name"):
            schema = self.schemas.require(kind)
            now = self.clock.timestamp()
            valid_from = str(spec.get("valid_from") or "") or None
            placed = placement.resolve(schema, spec["fields"], self.config, self.layout.groups_of(kind), valid_from=valid_from, now=now)
            spec["name"] = placement.portable_segment(f"{self.segment(project)}-{kind}-{placed.name}", self.config)
        return super()._prepare(spec, archive_excerpts=archive_excerpts)
