import datetime as dt

import pytest
from agent_memory.core.clock import FrozenClock

from battuta_memory.housekeeping import purge_retired
from battuta_memory.reads import Reads
from helpers import entity


@pytest.fixture
def store(store):
    store.clock = FrozenClock(dt.datetime(2026, 10, 1, tzinfo=dt.UTC))
    return store


def add(store, subject, project="mocktest", **extra):
    return store.record(**entity(project, subject, f"{subject} is a contact for {project}", **extra)).name


def names(store):
    return {record.name for record in store.records(include_invalid=True)}


def index_rows(store, path):
    relative = path.relative_to(store.root).as_posix()
    with store._database.connect() as connection:
        return {table: connection.execute(f"SELECT count(*) FROM {table} WHERE path = ?", (relative,)).fetchone()[0]
                for table in ("files", "records", "vector_files", "vector_chunks")}


@pytest.mark.parametrize(("days", "purged"), [(31, True), (29, False)], ids=["past-30-days-purged", "within-30-days-kept"])
def test_purges_by_retirement_age(store, days, purged):
    slug = add(store, "acme-ltd")
    path = store.find(slug).path
    store.delete(slug)
    store.clock.advance(days=days)
    report = purge_retired(store)
    assert (slug in report["purged"]) == purged
    assert path.exists() == (not purged)
    assert (store.find(slug) is None) == purged


def test_active_memories_are_kept(store):
    slug = add(store, "acme-ltd")
    store.clock.advance(days=365)
    assert purge_retired(store)["purged"] == []
    assert store.find(slug).is_active()


def test_counts_obsolete_and_deleted(store):
    old, recent = add(store, "acme-ltd"), add(store, "beta-ltd")
    add(store, "gamma-ltd")
    store.delete(old)
    store.clock.advance(days=20)
    store.delete(recent)
    store.clock.advance(days=11)
    report = purge_retired(store)
    assert (report["obsolete"], report["deleted"], report["purged"]) == (2, 1, [old])


def test_purged_memory_leaves_search_and_embedding_index(store):
    slug = add(store, "acme-ltd")
    path = store.find(slug).path
    store.delete(slug)
    assert all(index_rows(store, path).values())
    store.clock.advance(days=31)
    purge_retired(store)
    assert set(index_rows(store, path).values()) == {0}
    assert slug not in [memory["name"] for memory in Reads(store).recall(query="acme contact")["memories"]]


def test_prunes_empty_folders_but_keeps_type_folder_and_occupied_folders(store):
    alone, shared = add(store, "acme-ltd"), add(store, "beta-ltd", project="battuta")
    neighbour = add(store, "gamma-ltd", project="battuta")
    alone_dir, shared_dir = store.find(alone).path.parent, store.find(shared).path.parent
    store.delete(alone)
    store.delete(shared)
    store.clock.advance(days=31)
    purge_retired(store)
    assert not alone_dir.exists()
    assert shared_dir.exists()
    assert store.layout.type_dir("entity").is_dir()
    assert store.find(neighbour).is_active()


def test_second_run_does_nothing(store):
    slug = add(store, "acme-ltd")
    store.delete(slug)
    store.clock.advance(days=31)
    assert purge_retired(store)["purged"] == [slug]
    before = names(store)
    assert purge_retired(store) == {"obsolete": 0, "deleted": 0, "purged": [], "dangling_links": []}
    assert names(store) == before


def test_reports_links_left_pointing_at_purged_memory(store):
    old = add(store, "acme-ltd")
    new = add(store, "acme-group", links=[old])
    store.delete(old)
    store.clock.advance(days=31)
    assert purge_retired(store)["dangling_links"] == [[new, old]]
