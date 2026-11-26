"""Wrapper step after consolidation: one bounded digest per changed project, superseding the last one."""
import json_repair

from agent_memory.core import timestamp

from .layout import CONVERSATION_TYPES, OVERVIEW
from .store import project_of

ABSTRACT_LIMIT = 240
BODY_LIMIT = 4000
SOURCE_BODY_LIMIT = 600

PROMPT = """You maintain a short overview of one project ("{project}") for an AI chief of staff.
{purpose}

Write the overview from the memories below. They are the current, active knowledge; when two
seem to disagree, prefer the more recently updated one. State facts plainly, with names, dates
and numbers exactly as written. Keep the body under {budget} characters, in short markdown
sections or bullets.

Reply with one JSON object and nothing else:
{{"abstract": "<one line, at most 120 characters, describing the project>", "body": "<the overview>"}}

## Previous overview
{previous}

## Memories
{memories}"""

GLOBAL_PURPOSE = 'This is the owner card, loaded at the start of every conversation: who the owner is, their role, standing preferences and the people and commitments that matter most. The abstract describes the owner in one line.'
PROJECT_PURPOSE = "It answers \"what do we know about {project}?\": what the project is, who is involved, key decisions, dates and open commitments."


def _instant(value):
    return timestamp.parse(value) if value else None


def active_overviews(store, segment):
    found = [record for record in store.records() if record.type == OVERVIEW and project_of(record) == segment]
    return sorted(found, key=lambda record: (record.created, record.name), reverse=True)


def changed(store, segment) -> bool:
    knowledge = [record for record in store.records(include_invalid=True) if project_of(record) == segment and record.type in CONVERSATION_TYPES]
    if not knowledge:
        return False
    current = active_overviews(store, segment)
    if not current:
        return True
    written = _instant(current[0].created)
    # Stamps have one-second resolution: a same-second change counts, at worst costing one extra refresh.
    return any(max(filter(None, (_instant(record.updated), _instant(record.invalid_at)))) >= written for record in knowledge)


def _parse(reply: str) -> tuple[str, str]:
    payload = json_repair.loads(reply)
    if not isinstance(payload, dict):
        raise ValueError("overview reply has no JSON object")
    abstract, body = str(payload.get("abstract") or "").strip(), str(payload.get("body") or "").strip()
    if not abstract or not body:
        raise ValueError("overview reply needs abstract and body")
    return " ".join(abstract.split())[:ABSTRACT_LIMIT], body[:BODY_LIMIT]


def refresh_project(store, project: str, ask, today: str) -> str:
    segment = store.segment(project)
    previous = active_overviews(store, segment)
    sources = sorted((record for record in store.records() if project_of(record) == segment and record.type in CONVERSATION_TYPES),
                     key=lambda record: (record.type, record.name))
    memories = "\n".join(f"- [{record.type}, updated {record.updated}] {record.abstract}\n  {record.body.strip()[:SOURCE_BODY_LIMIT]}" for record in sources) or "(none)"
    purpose = GLOBAL_PURPOSE if project == "global" else PROJECT_PURPOSE.format(project=project)
    prompt = PROMPT.format(project=project, purpose=purpose, budget=BODY_LIMIT, memories=memories,
                           previous=previous[0].body.strip() if previous else "(none yet)")
    abstract, body = _parse(ask(prompt))
    with store.overview_writes():
        written = store.record(type=OVERVIEW, fields={"project": project, "subject": today}, abstract=abstract, body=body,
                               links=[record.name for record in sources][:50])
    for old in previous:
        store.supersede(old.name, written.name)
    return written.name


def refresh_overviews(store, ask, today: str) -> list[str]:
    refreshed = []
    for project in store.catalog():
        if changed(store, store.segment(project)):
            refresh_project(store, project, ask, today)
            refreshed.append(project)
    return refreshed
