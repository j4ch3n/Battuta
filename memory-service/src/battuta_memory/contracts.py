"""Validated, framework-neutral public requests. Reserved metadata is never caller-controlled."""

import re
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


def project_names(names):
    if len(names) > 100 or any(not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}", n) for n in names):
        raise ValueError("Invalid project name")
    return sorted(set(names))


class Scope(Contract):
    global_: bool = Field(alias="global", strict=True)
    projects: list[str] = Field(default_factory=list)
    _projects = field_validator("projects")(project_names)

    @model_validator(mode="after")
    def unambiguous(self):
        if self.global_ == bool(self.projects):
            raise ValueError("Scope must be global OR one or more projects")
        return self


class SourceRef(Contract):
    agent_id: Literal["pm", "tl"]
    session_id: str = Field(min_length=1, max_length=200)
    entry_id: str = Field(min_length=1, max_length=200)


class Tagged(Contract):
    tags: list[str] = Field(default_factory=list, max_length=100)

    @field_validator("tags")
    @classmethod
    def tags_valid(cls, tags):
        tags = sorted(set(t.strip().lower() for t in tags))
        if any(not t or len(t) > 100 or "," in t or t.startswith(("proj:", "scope:", "kind:")) for t in tags):
            raise ValueError("Invalid or reserved tag")
        return tags


class RememberRequest(Tagged):
    content: str = Field(min_length=1, max_length=16000)
    scope: Scope
    kind: str = Field(default="observation", pattern=r"^[a-z][a-z0-9_-]{0,39}$")
    sources: list[SourceRef] = Field(default_factory=list, max_length=200)
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=200)

    @field_validator("content")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("Empty memory content")
        return value


class Selector(Tagged):
    selector: Literal["current", "projects", "global", "all"] = "current"
    projects: list[str] = Field(default_factory=list)
    include_global: bool = True
    include_history: bool = False
    kind: str | None = Field(default=None, pattern=r"^[a-z][a-z0-9_-]{0,39}$")
    tag_match: Literal["all", "any"] = "all"
    _projects = field_validator("projects")(project_names)

    @model_validator(mode="after")
    def projects_selector(self):
        if (self.selector == "projects") != bool(self.projects):
            raise ValueError("Projects required only for projects selector")
        return self


class RecallRequest(Selector):
    query: str = Field(min_length=1, max_length=16000)
    limit: int = Field(default=10, ge=1, le=100)


class ListRequest(Selector):
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=100)


class InventoryRequest(Contract):
    window_start: float = Field(ge=0, allow_inf_nan=False)
    window_end: float = Field(gt=0, allow_inf_nan=False)
    max_records: int = Field(default=500, ge=1, le=2000)

    @model_validator(mode="after")
    def ordered_window(self):
        if self.window_start >= self.window_end:
            raise ValueError("Inventory window must be ordered")
        return self


class GetRequest(Contract):
    ref: str = Field(pattern=r"^[0-9a-f]{64}$")
    include_history: bool = False


class UpdateRequest(GetRequest):
    expected_revision: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    content: str = Field(min_length=1, max_length=16000)
    reason: str = Field(min_length=1, max_length=1000)
    kind: str | None = Field(default=None, pattern=r"^[a-z][a-z0-9_-]{0,39}$")
    tags: list[str] | None = None

    @field_validator("content", "reason")
    @classmethod
    def nonblank(cls, value):
        return RememberRequest.nonblank(value)

    @field_validator("tags")
    @classmethod
    def validate_tags(cls, value):
        return Tagged(tags=value).tags if value is not None else None


class LinkRequest(GetRequest):
    add: list[str] = Field(default_factory=list)
    remove: list[str] = Field(default_factory=list)
    _names = field_validator("add", "remove")(project_names)

    @model_validator(mode="after")
    def disjoint(self):
        if set(self.add) & set(self.remove):
            raise ValueError("Overlapping membership changes")
        return self


class ForgetRequest(GetRequest):
    expected_revision: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    dry_run: bool = False


class CaptureItem(RememberRequest):
    item_id: str = Field(min_length=1, max_length=200)


class CaptureBatch(Contract):
    session_id: str = Field(min_length=1, max_length=200)
    batch_id: str = Field(min_length=1, max_length=200)
    agent_id: Literal["pm", "tl"]
    payload_digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    items: list[CaptureItem] = Field(max_length=20)

    @model_validator(mode="after")
    def valid_sources(self):
        if len({i.item_id for i in self.items}) != len(self.items):
            raise ValueError("Duplicate item IDs")
        for item in self.items:
            if not item.sources or any(s.agent_id != self.agent_id or s.session_id != self.session_id for s in item.sources):
                raise ValueError("Capture source must identify this agent/session")
        return self


class ToolSuccess(Contract):
    ok: Literal[True] = True
    data: dict
    warnings: list[str] = Field(default_factory=list)


class ToolFailure(Contract):
    ok: Literal[False] = False
    error: dict
