import json
import os

import pytest
from agent_memory.core import reasoning
from agent_memory.core.watermark import Watermark
from battuta_memory.archive import ingest
from battuta_memory.dream import DreamState, run_dream
from battuta_memory.manage import BattutaManage
from battuta_memory.overview import active_overviews
from battuta_memory.reads import Reads
from helpers import entity, make_store


def upload(store, *lines):
    body = "\n".join(json.dumps({"entry_id": f"e-{abs(hash(text))}", "conversation_id": "c1", "speaker": speaker, "text": text,
                                 "timestamp": f"2026-11-26T09:0{index}:00+00:00"}) for index, (speaker, text) in enumerate(lines))
    ingest(store, body.encode())


class StubDistiller:
    """Answers the library's text protocol with prepared operations, like a model would."""

    def __init__(self, *operations):
        self.operations = list(operations)
        self.prompts = []

    def __call__(self, prompt):
        self.prompts.append(prompt)
        return "\n".join(json.dumps({"op": "new", **operation}) for operation in self.operations)


class StubOverview:
    def __init__(self):
        self.projects = []

    def __call__(self, prompt):
        project = prompt.split('("', 1)[1].split('")', 1)[0]
        self.projects.append(project)
        memories = prompt.split("## Memories", 1)[1].strip()
        return json.dumps({"abstract": f"{project} line", "body": f"Digest of {project}:\n{memories}"})


def no_review(_prompt):
    return ""


@pytest.fixture
def dream_store(tmp_path):
    return make_store(tmp_path, distill_view=True)


@pytest.fixture
def state(dream_store):
    state = DreamState(dream_store.root)
    state.start(os.getpid())
    return state


def dream(store, state, distiller, overview, today="2026-11-26"):
    return run_dream(store, state, write_reasoner=distiller, manage_reasoner=no_review, ask=overview,
                     catalog=lambda: ["battuta", "mocktest"], today=today)


def test_dream_distills_backlog_and_writes_overview(dream_store, state):
    store = dream_store
    upload(store, ("owner", "I'm Jason, CEO of Fiscum"), ("owner", "MockTest's client is Acme Ltd"), ("cos", "Noted."))
    distiller = StubDistiller(
        {"type": "profile", "fields": {"project": "global", "subject": "name"}, "abstract": "The owner is Jason, CEO of Fiscum", "body": "Jason is CEO of Fiscum."},
        {"type": "entity", "fields": {"project": "mocktest", "subject": "acme-ltd"}, "abstract": "Acme Ltd is the MockTest client", "body": "Client."})
    overview = StubOverview()
    report = dream(store, state, distiller, overview)
    names = {record.path.relative_to(store.root).as_posix() for record in store.records()}
    assert {"profile/global/global-profile-name.md", "entity/mocktest/mocktest-entity-acme-ltd.md",
            "overview/global/global-overview-2026-11-26.md", "overview/mocktest/mocktest-overview-2026-11-26.md"} <= names
    assert sorted(report["overviews"]) == ["global", "mocktest"]
    assert report["housekeeping"] == {"obsolete": 0, "deleted": 0, "purged": [], "dangling_links": []}
    assert "CEO of Fiscum" in Reads(store).profile()["body"]
    assert Watermark(store.layout).read("cos-2026-11-26").backlog() == 0
    assert state.read()["status"] == "succeeded"
    assert state.read()["last_success_at"] is not None


def test_second_dream_supersedes_previous_overview_and_skips_unchanged(dream_store, state):
    store = dream_store
    upload(store, ("owner", "MockTest's client is Acme Ltd"))
    dream(store, state, StubDistiller({"type": "entity", "fields": {"project": "mocktest", "subject": "acme-ltd"}, "abstract": "Acme Ltd is the MockTest client"}), StubOverview())
    state.start(os.getpid())
    upload(store, ("owner", "MockTest now launches on 2027-04-15"))
    overview = StubOverview()
    dream(store, state, StubDistiller({"type": "fact", "fields": {"project": "mocktest", "subject": "launch-date"}, "abstract": "MockTest launches on 2027-04-15"}), overview, today="2026-11-27")
    assert overview.projects == ["mocktest"]
    current = active_overviews(store, "mocktest")
    assert [record.name for record in current] == ["mocktest-overview-2026-11-27"]
    old = store.find("mocktest-overview-2026-11-26")
    assert not old.is_active()
    assert old.superseded_by == "mocktest-overview-2026-11-27"


def test_same_day_dreams_give_each_overview_its_own_name_and_file(dream_store, state):
    store = dream_store
    for index, text in enumerate(("MockTest's client is Acme Ltd", "MockTest now launches on 2027-04-15")):
        state.start(os.getpid())
        upload(store, ("owner", text))
        dream(store, state, StubDistiller({"type": "fact", "fields": {"project": "mocktest", "subject": f"fact-{index}"}, "abstract": text}), StubOverview())
    current = active_overviews(store, "mocktest")
    assert [record.name for record in current] == ["mocktest-overview-2026-11-26-2"]
    assert current[0].path.stem == current[0].name
    assert store.find("mocktest-overview-2026-11-26").superseded_by == "mocktest-overview-2026-11-26-2"


def test_unchanged_store_makes_no_overview_call(dream_store, state):
    overview = StubOverview()
    dream(dream_store, state, StubDistiller(), overview)
    assert overview.projects == []


def test_distill_failure_keeps_watermark_and_records_failed_step(dream_store, state):
    upload(dream_store, ("owner", "MockTest's client is Acme Ltd"))

    def broken(_prompt):
        raise RuntimeError("host unavailable")

    with pytest.raises(RuntimeError, match="host unavailable"):
        dream(dream_store, state, broken, StubOverview())
    current = state.read()
    assert (current["status"], current["report"]["failed_step"]) == ("failed", "distill")
    assert Watermark(dream_store.layout).read("cos-2026-11-26").backlog() == 1


def test_recall_cooccurrence_links_stay_within_one_project(store):
    for project, subject in (("battuta", "acme"), ("mocktest", "acme"), ("mocktest", "invoices")):
        store.record(**entity(project, subject, f"Acme Ltd invoices for {project} {subject}"))
    with store.overview_writes():
        store.record(type="overview", fields={"project": "mocktest", "subject": "2026-11-26"}, abstract="Acme Ltd invoices digest", body="Acme Ltd invoices")
    for _ in range(3):
        Reads(store).recall(query="Acme Ltd invoices")
    BattutaManage(store).sleep(reasoner=no_review)
    links = {record.name: set(record.links) for record in store.records()}
    assert links["mocktest-entity-acme"] == {"mocktest-entity-invoices"}
    assert links["battuta-entity-acme"] == set()
    assert links["mocktest-overview-2026-11-26"] == set()


def test_filters_cross_project_and_overview_proposals(store):
    store.record(**entity("battuta", "acme", "Acme Ltd is the client paying monthly invoices"))
    store.record(**entity("mocktest", "acme", "Acme Ltd is the client paying monthly invoices"))
    assert BattutaManage(store).proposals() == []
    store.record(**entity("battuta", "acme-ltd", "Acme Ltd is the client paying monthly invoices"))
    kinds = [(proposal.kind, sorted(proposal.targets)) for proposal in BattutaManage(store).proposals()]
    assert (reasoning.PROPOSAL_SUPERSEDE, ["battuta-entity-acme", "battuta-entity-acme-ltd"]) in kinds
    with store.overview_writes():
        store.record(type="overview", fields={"project": "battuta", "subject": "2026-11-26"}, abstract="x", body="Acme Ltd is the client paying monthly invoices")
    assert all("battuta-overview-2026-11-26" not in proposal.targets for proposal in BattutaManage(store).proposals())
