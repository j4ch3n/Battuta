"""Read side shared by both MCP endpoints: recall mapping, project overviews and the owner card."""
from agent_memory.core.recall import Recall

from .layout import CONVERSATION_TYPES, OVERVIEW
from .store import GLOBAL, project_of

BODY_LIMIT = 2000
ABSTRACT_LIMIT = 50


class Reads:
    def __init__(self, store):
        self.store = store

    def types(self) -> list[dict]:
        return [{"type": schema.type, "description": schema.description} for schema in self.store.schemas.all() if schema.type in CONVERSATION_TYPES]

    def _segments(self) -> dict[str, str]:
        return {self.store.segment(name): name for name in self.store.catalog()}

    def _resolve(self, project: str) -> str | None:
        return self._segments().get(self.store.segment(project)) and self.store.segment(project)

    def _overviews(self, segment: str) -> list:
        found = [record for record in self.store.records() if record.type == OVERVIEW and project_of(record) == segment]
        return sorted(found, key=lambda record: (record.created, record.name), reverse=True)

    def project_overview(self, project: str) -> dict:
        segment = self._resolve(project)
        if segment is None:
            return {"status": "unknown_project", "projects": self.store.catalog()}
        overviews = self._overviews(segment)
        if not overviews:
            return {"status": "not_written"}
        return {"status": "ok", "overview": {"body": "\n\n".join(record.body.strip() for record in overviews),
            "abstract": overviews[0].abstract, "created": overviews[0].created}}

    def project_descriptions(self, projects: list[str] | None = None) -> dict:
        names = projects if projects is not None else self.store.catalog()
        descriptions = {}
        for name in names:
            segment = self._resolve(name)
            overviews = self._overviews(segment) if segment else []
            descriptions[name] = overviews[0].abstract if overviews else None
        return {"descriptions": descriptions}

    def profile(self) -> dict:
        result = self.project_overview(GLOBAL)
        return {"status": "ok", "body": result["overview"]["body"]} if result["status"] == "ok" else {"status": "not_written"}

    def _memory(self, record) -> dict:
        return {"name": record.name, "type": record.type, "project": project_of(record), "abstract": record.abstract,
            "body": record.body.strip()[:BODY_LIMIT], "updated": record.updated}

    def recall(self, projects=None, types=None, query=None, limit: int = 10) -> dict:
        projects, types, query = projects or [], types or [], (query or "").strip()
        unknown = [name for name in projects if self._resolve(name) is None]
        bad_types = [name for name in types if name not in CONVERSATION_TYPES]
        if unknown or bad_types or not (projects or query):
            return {"status": "invalid", "error": "unknown projects or types, or nothing to look up",
                "unknown_projects": unknown, "unknown_types": bad_types, "projects": self.store.catalog(), "types": list(CONVERSATION_TYPES)}
        segments = [self._resolve(name) for name in projects]
        if not query:
            memories = []
            for segment in segments:
                overviews = self._overviews(segment)
                if overviews:
                    memories.extend(self._memory(record) for record in overviews)
                else:
                    active = [record for record in self.store.records() if project_of(record) == segment and record.type != OVERVIEW]
                    memories.extend({**self._memory(record), "body": ""} for record in sorted(active, key=lambda r: (r.type, r.name))[:ABSTRACT_LIMIT])
            return {"status": "ok", "memories": memories}
        recall = Recall(self.store)
        if segments:
            hits = [hit for segment in segments for kind in (types or CONVERSATION_TYPES) for hit in recall.recall(query, scope=f"{kind}/{segment}", limit=limit)]
        else:
            hits = [hit for hit in recall.recall(query, limit=limit * 2) if hit.type != OVERVIEW and (not types or hit.type in types)]
        best = {}
        for hit in sorted(hits, key=lambda hit: hit.score, reverse=True):
            best.setdefault(hit.name, hit)
        memories = [self._memory(record) for hit in list(best.values())[:limit] if (record := self.store.find(hit.name)) is not None]
        return {"status": "ok", "memories": memories}
