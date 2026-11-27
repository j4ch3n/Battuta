from unittest import mock

import pytest

from battuta_memory.reads import Reads
from helpers import entity


def overview(store, project, day, abstract, body):
    with store.overview_writes():
        return store.record(type="overview", fields={"project": project, "subject": day}, abstract=abstract, body=body)


@pytest.fixture
def reads(store):
    return Reads(store)


def test_project_overview_ok_one_and_several_newest_first(store, reads):
    with mock.patch.object(store.clock, "timestamp", return_value="2026-11-25T05:00:00+00:00"):
        overview(store, "battuta", "2026-11-25", "Old line", "Old digest.")
    assert reads.project_overview("battuta")["overview"]["body"] == "Old digest."
    with mock.patch.object(store.clock, "timestamp", return_value="2026-11-26T05:00:00+00:00"):
        overview(store, "battuta", "2026-11-26", "New line", "New digest.")
    result = reads.project_overview("battuta")
    assert result["status"] == "ok"
    assert result["overview"]["body"] == "New digest.\n\nOld digest."
    assert result["overview"]["abstract"] == "New line"


def test_project_overview_not_written_and_unknown(reads):
    assert reads.project_overview("battuta") == {"status": "not_written"}
    assert reads.project_overview("atlas") == {"status": "unknown_project", "projects": ["battuta", "global", "mocktest"]}


def test_descriptions_none_for_missing(store, reads):
    overview(store, "battuta", "2026-11-26", "AI team project", "Digest.")
    assert reads.project_descriptions()["descriptions"] == {"battuta": "AI team project", "global": None, "mocktest": None}


def test_recall_projects_types_query_scopes_to_pair(store, reads):
    store.record(**entity("mocktest", "acme-ltd", "Acme Ltd is the client for MockTest"))
    store.record(type="fact", fields={"project": "mocktest", "subject": "client-contract"}, abstract="The Acme client contract runs to 2027")
    store.record(**entity("battuta", "acme-ltd", "Acme Ltd also advises battuta"))
    result = reads.recall(projects=["mocktest"], types=["entity"], query="who is the client")
    assert [memory["name"] for memory in result["memories"]] == ["mocktest-entity-acme-ltd"]


def test_recall_projects_only_returns_overview_or_abstracts(store, reads):
    store.record(**entity("mocktest", "acme-ltd", "Acme Ltd is the client", "Signed 2026."))
    abstracts = reads.recall(projects=["mocktest"])["memories"]
    assert [(m["name"], m["body"]) for m in abstracts] == [("mocktest-entity-acme-ltd", "")]
    overview(store, "mocktest", "2026-11-26", "Banking prototype", "Client Acme Ltd.")
    assert [m["type"] for m in reads.recall(projects=["mocktest"])["memories"]] == ["overview"]


@pytest.mark.parametrize("arguments", [{"projects": ["atlas"], "query": "x"}, {"types": ["person"], "query": "x"}, {}],
                         ids=["unknown-project", "unknown-type", "no-filter"])
def test_recall_rejects_unknown_project_or_type_with_lists(reads, arguments):
    result = reads.recall(**arguments)
    assert result["status"] == "invalid"
    assert "mocktest" in result["projects"]
    assert "entity" in result["types"]


def test_query_recall_skips_overviews(store, reads):
    store.record(**entity("mocktest", "acme-ltd", "Acme Ltd is the client for MockTest"))
    overview(store, "mocktest", "2026-11-26", "Acme client banking prototype", "Acme Ltd is the client.")
    assert [m["type"] for m in reads.recall(query="Acme client")["memories"]] == ["entity"]


def test_profile_reads_global_overview(store, reads):
    assert reads.profile() == {"status": "not_written"}
    overview(store, "global", "2026-11-26", "Jason, CEO of Fiscum", "Jason Chen is the founder and CEO of Fiscum.")
    assert reads.profile() == {"status": "ok", "body": "Jason Chen is the founder and CEO of Fiscum."}


def test_types_lists_conversation_types_only(reads):
    assert "overview" not in [item["type"] for item in reads.types()]
    assert len(reads.types()) == 10
