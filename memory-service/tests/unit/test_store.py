import pytest
from agent_memory.core.errors import ValidationError
from battuta_memory.store import write_catalog
from helpers import entity, make_store


@pytest.fixture
def store(tmp_path):
    return make_store(tmp_path, projects=("battuta", "acme-site"))


def test_derives_unique_names_across_projects_and_types(store):
    store.record(**entity("battuta", "acme", "Acme is the client for battuta"))
    store.record(**entity("acme-site", "acme", "Acme owns the acme-site project"))
    store.record(type="fact", fields={"project": "global", "subject": "acme"}, abstract="Acme is a London firm")
    paths = {record.name: record.path.relative_to(store.root).as_posix() for record in store.records()}
    assert paths == {
        "battuta-entity-acme": "entity/battuta/battuta-entity-acme.md",
        "acme-site-entity-acme": "entity/acme-site/acme-site-entity-acme.md",
        "global-fact-acme": "fact/global/global-fact-acme.md",
    }


def test_same_key_upserts_same_file(store):
    for _ in range(2):
        store.record(**entity("battuta", "acme", "Acme is the client", "Signed in 2026"))
    assert [record.name for record in store.records()] == ["battuta-entity-acme"]


def test_rejects_unknown_project_and_lists_catalog(store):
    with pytest.raises(ValidationError) as caught:
        store.record(**entity("atlas", "acme", "Acme"))
    assert "acme-site, battuta, global" in str(caught.value.errors)


def test_rejects_overview_outside_wrapper(store):
    spec = {"type": "overview", "fields": {"project": "battuta", "subject": "2026-11-26"}, "abstract": "Battuta digest", "body": "Digest."}
    with pytest.raises(ValidationError):
        store.record(**spec)
    with store.overview_writes():
        written = store.record(**spec)
    assert written.name == "battuta-overview-2026-11-26"


def test_check_many_applies_same_rules(store):
    refused = store.check_many([
        {"type": "overview", "fields": {"project": "battuta", "subject": "x"}, "abstract": "digest"},
        entity("atlas", "acme", "Acme"),
        entity("battuta", "acme", "Acme is the client"),
    ])
    assert [item.index for item in refused] == [0, 1]


def test_catalog_slug_collision_refused(store):
    with pytest.raises(ValueError):
        write_catalog(store.root, ["Acme Site", "acme-site"])
