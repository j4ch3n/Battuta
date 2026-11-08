"""Validated, framework-neutral public requests. Reserved metadata is never caller-controlled."""

import re
import unicodedata
from datetime import datetime, timezone
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


def project_names(names):
    if len(names) > 100:
        raise ValueError("Invalid project name")
    return sorted(set(n.lower() for n in names))


class Scope(Contract):
    global_: bool = Field(alias="global", strict=True)
    projects: list[str] = Field(default_factory=list)
    _projects = field_validator("projects")(project_names)

    @model_validator(mode="after")
    def unambiguous(self):
        if self.global_ == bool(self.projects):
            raise ValueError("Scope must be global OR one or more projects")
        return self


class OriginalMail(Contract):
    message_ref: dict[str, str]
    sender: str = Field(min_length=1, max_length=200)


class SourceAttribution(Contract):
    speaker: Literal["owner", "assistant", "agent"]
    mentioned_at: str | None = None
    timezone: str | None = None
    original_mail: OriginalMail | None = None

    @field_validator("mentioned_at")
    @classmethod
    def source_instant(cls, value):
        utc_timestamp(value)
        return value


class SourceRef(Contract):
    agent_id: Literal["cos", "manager"]
    session_id: str = Field(min_length=1, max_length=200)
    entry_id: str = Field(min_length=1, max_length=200)
    attribution: SourceAttribution | None = None

    def wire(self):
        return self.model_dump(exclude={"attribution"} if self.attribution is None else set())


class Tagged(Contract):
    tags: list[str] = Field(default_factory=list, max_length=100)

    @field_validator("tags")
    @classmethod
    def tags_valid(cls, tags):
        tags = sorted(set(t.strip().lower() for t in tags))
        if any(not t or len(t) > 100 or "," in t or t.startswith(("proj:", "scope:", "kind:")) for t in tags):
            raise ValueError("Invalid or reserved tag")
        return tags


class EvidenceRef(Contract):
    ref: str = Field(pattern=r"^[0-9a-f]{64}$")
    revision: str = Field(pattern=r"^[0-9a-f]{64}$")


class EvidenceGuard(Contract):
    evidence: list[EvidenceRef] = Field(default_factory=list, max_length=100)


def utc_timestamp(value):
    if value is None:
        return None
    instant = datetime.fromisoformat(value)
    if "T" not in value or instant.utcoffset() is None:
        raise ValueError("Timestamp needs an explicit timezone")
    return instant.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


class EvidenceLink(EvidenceRef):
    relation: Literal["supports", "contradicts"]
    requirement: Literal["historical", "current"]


class MemoryMetadata(Contract):
    stage: Literal["temporal", "durable"]
    knowledge_type: Literal["fact", "synthesized-observation", "hypothesis"]
    confidence: Literal["confirmed", "supported", "tentative", "disputed"]
    status: Literal["active", "stale", "superseded", "rejected"]
    keywords: list[str] = Field(default_factory=list, max_length=20)
    mentioned_at: str | None = None
    expires_at: str | None = None
    rationale: str | None = Field(default=None, min_length=1, max_length=1000)
    evidence: list[EvidenceLink] = Field(default_factory=list, max_length=100)
    _times = field_validator("mentioned_at", "expires_at")(utc_timestamp)

    @field_validator("keywords")
    @classmethod
    def valid_keywords(cls, values):
        values = [v.strip() for v in values]
        if any(not v or len(v) > 80 or any(unicodedata.category(c).startswith("C") for c in v)
                or re.search(r"(?i)(?:bearer\s|sk-[a-z0-9]{12}|(?:token|password|secret)\s*[:=])", v) for v in values):
            raise ValueError("Invalid keyword")
        if len({unicodedata.normalize("NFKC", v).casefold() for v in values}) != len(values):
            raise ValueError("Duplicate keywords")
        return values

    @model_validator(mode="after")
    def supported_claim(self):
        if self.knowledge_type != "fact" and (not self.rationale or not any(e.relation == "supports" for e in self.evidence)):
            raise ValueError("Derived claims require supporting evidence and rationale")
        if self.knowledge_type != "fact" and self.confidence == "confirmed":
            raise ValueError("Inference is not owner confirmation")
        return self


class RememberContent(Tagged):
    content: str = Field(min_length=1, max_length=16000)
    projects: list[str] = Field(min_length=1, max_length=100)
    _projects = field_validator("projects")(project_names)

    @field_validator("projects")
    @classmethod
    def exclusive_global(cls, names):
        if "global" in names and names != ["global"]:
            raise ValueError("Global membership must stand alone")
        return names

    @property
    def scope(self):
        return Scope.model_validate({"global": self.projects == ["global"],
            "projects": [] if self.projects == ["global"] else self.projects})

    kind: str = Field(default="observation", pattern=r"^[a-z][a-z0-9_-]{0,39}$")
    sources: list[SourceRef] = Field(default_factory=list, max_length=200)
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=200)
    memory_metadata: MemoryMetadata | None = None

    @field_validator("content")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("Empty memory content")
        return value


class RememberRequest(RememberContent, EvidenceGuard):
    pass


class Selector(Tagged):
    selector: Literal["projects", "global", "all"]
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
        if "global" in self.projects:
            raise ValueError("Use explicit global selection")
        return self


class RecallRequest(Selector):
    selector: Literal["projects", "global", "all"] = "all"
    semantic_query: str | None = Field(default=None, min_length=1, max_length=16000)
    keywords: list[str] = Field(default_factory=list, max_length=32)
    limit: int = Field(default=10, ge=1, le=100)
    include_expired: bool = False

    @model_validator(mode="before")
    @classmethod
    def explicit_projects(cls, value):
        if isinstance(value, dict) and value.get("projects") and "selector" not in value:
            value = {**value, "selector": "projects"}
        return value

    @field_validator("keywords")
    @classmethod
    def literal_keywords(cls, values):
        terms = [unicodedata.normalize("NFKC", v).strip().casefold() for v in values]
        if any(not v or len(v) > 80 or any(unicodedata.category(c).startswith("C") for c in v) for v in terms):
            raise ValueError("Invalid keyword terms")
        return list(dict.fromkeys(terms))

    @model_validator(mode="after")
    def usable_query(self):
        if self.semantic_query is not None:
            self.semantic_query = self.semantic_query.strip()
            if not self.semantic_query:
                raise ValueError("Blank semantic query")
        if not self.semantic_query and not self.keywords:
            raise ValueError("Provide semantic_query or keywords")
        return self


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


class ConsolidateGlobalRequest(Contract):
    run_id: str = Field(min_length=1, max_length=64)

    @field_validator("run_id")
    @classmethod
    def explicit_instant(cls, value):
        instant = datetime.fromisoformat(value)
        if "T" not in value or instant.utcoffset() is None:
            raise ValueError("Run identity must be an explicit instant")
        return value


class GetRequest(Contract):
    ref: str = Field(pattern=r"^[0-9a-f]{64}$")
    include_history: bool = False


class UpdateRequest(GetRequest, EvidenceGuard):
    memory_metadata: MemoryMetadata | None = None
    sources: list[SourceRef] = Field(default_factory=list, max_length=200)
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


class SetMetadataRequest(GetRequest, EvidenceGuard):
    expected_revision: str = Field(pattern=r"^[0-9a-f]{64}$")
    idempotency_key: str = Field(min_length=1, max_length=200)
    memory_metadata: MemoryMetadata
    replacement_ref: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")


class ForgetRequest(GetRequest, EvidenceGuard):
    expected_revision: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    replacement_ref: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    dry_run: bool = False


class CaptureItem(RememberContent):
    item_id: str = Field(min_length=1, max_length=200)
    correction: EvidenceRef | None = None


class CaptureBatch(Contract):
    session_id: str = Field(min_length=1, max_length=200)
    batch_id: str = Field(min_length=1, max_length=200)
    agent_id: Literal["cos", "manager"]
    payload_digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    items: list[CaptureItem]

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
