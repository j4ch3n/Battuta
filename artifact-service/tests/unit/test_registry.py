import sqlite3
from pathlib import Path

import pytest
from alembic import command
from sqlalchemy import URL, create_engine

from battuta_artifacts.registry import Conflict, Registry, SchemaError, migrate, migration_config


@pytest.fixture
def path(tmp_path):
    return tmp_path / "registry.sqlite3"


@pytest.fixture
def registry(path):
    migrate(path)
    return Registry(path)


def test_deregister_project_withdraws_owned_and_path_artifacts_only(registry, tmp_path):
    root = tmp_path / "atlas"
    root.mkdir()
    source = root / "source.md"
    source.write_text("keep me")
    for slug, project, source_root, status in (
        ("owned", "atlas", "/outside", "draft"),
        ("path", None, str(root), "published"),
        ("other", "other", str(root.parent / "atlas-other"), "published"),
    ):
        registry.register(slug=slug, title=slug, description=slug, source_root=source_root,
                          entry_path="source.md", format="markdown", files={"source.md": "text/markdown"},
                          project=project, name=slug if project else None, status=status)

    assert set(registry.deregister_project("atlas", root)) == {"owned", "path"}
    assert [item["slug"] for item in registry.list()] == ["other"]
    assert source.read_text() == "keep me"


def test_deregister_project_rolls_back_on_failure(registry, path):
    for slug in ("one", "two"):
        registry.register(slug=slug, title=slug, description=slug, source_root="/atlas",
                          entry_path="index.html", format="html", files={"index.html": "text/html"},
                          project="atlas", name=slug)
    with sqlite3.connect(path) as db:
        db.execute("""CREATE TRIGGER refuse_delete BEFORE DELETE ON artifacts
                   WHEN OLD.slug = 'two' BEGIN SELECT RAISE(ABORT, 'blocked'); END""")

    with pytest.raises(sqlite3.IntegrityError, match="blocked"):
        registry.deregister_project("atlas", Path("/atlas"))
    assert {item["slug"] for item in registry.list()} == {"one", "two"}


def test_deregister_project_finds_allowlisted_files_below_project(registry, tmp_path):
    registry.register(slug="nested", title="Nested", description="Nested",
                      source_root=str(tmp_path), entry_path="index.html", format="html",
                      files={"index.html": "text/html", "atlas/report.md": "text/markdown"})

    assert registry.deregister_project("atlas", tmp_path / "atlas") == ["nested"]
    assert registry.list() == []


def test_upgrade_preserves_published_records_and_defaults_new_rows_to_draft(path):
    engine = create_engine(URL.create("sqlite", database=str(path)))
    with engine.begin() as connection:
        config = migration_config()
        config.attributes["connection"] = connection
        command.upgrade(config, "0001_registry")
        connection.exec_driver_sql("INSERT INTO artifacts VALUES ('old', 'old', 'Old', 'Existing', '/source', 'index.html', 'html', 1, 'then', 'then')")
        connection.exec_driver_sql("INSERT INTO artifact_files VALUES ('old', 'index.html', 'text/html')")
    engine.dispose()
    migrate(path)
    registry = Registry(path)

    assert registry.get("old")["status"] == "published"
    item = registry.register(slug="new", title="New", description="Draft", source_root="/source",
                             entry_path="index.html", format="html", files={"index.html": "text/html"},
                             template="report", project="procurement", name="new")
    assert item["status"] == "draft"
    assert item["template"] == "report"
    assert [row["slug"] for row in registry.list(published_only=True)] == ["old"]
    with sqlite3.connect(path) as db:
        db.execute("""INSERT INTO artifacts (id, slug, title, description, source_root, entry_path, format, created_at, updated_at)
                   VALUES ('raw', 'raw', 'Raw', 'Default', '/source', 'index.html', 'html', 'now', 'now')""")
        db.execute("INSERT INTO artifact_files VALUES ('raw', 'index.html', 'text/html')")
        assert db.execute("SELECT status FROM artifacts WHERE id='raw'").fetchone()[0] == "draft"
        with pytest.raises(sqlite3.IntegrityError):
            db.execute("UPDATE artifacts SET status='private'")


def test_publication_is_atomic_idempotent_and_revision_guarded(registry):
    item = registry.register(slug="draft", title="Draft", description="Hidden", source_root="/source",
                             entry_path="index.html", format="html", files={"index.html": "text/html"})
    item = registry.publish("draft", files={**item["files"], "plot.json": "application/json"}, expected_revision=1)

    assert (item["status"], item["revision"]) == ("published", 2)
    assert "plot.json" in item["files"]
    assert registry.publish("draft", files=item["files"], expected_revision=2) == item
    with pytest.raises(Conflict):
        registry.publish("draft", files=item["files"], expected_revision=1)


def test_schema_requires_explicit_setup_and_setup_is_idempotent(path):
    with pytest.raises(SchemaError, match="setup"):
        Registry(path).check_schema()
    assert not path.exists()
    migrate(path)
    migrate(path)
    Registry(path).check_schema()


def test_register_conflict_update_and_deregister(registry, path):
    item = registry.register(slug="demo", title="Demo", description="Walkthrough",
                             source_root="/source", entry_path="index.html", format="html",
                             files={"index.html": "text/html", "app.js": "text/javascript"})
    assert item["revision"] == 1
    assert len(registry.list()) == 1
    with pytest.raises(Conflict):
        registry.register(slug="demo", title="Other", description="Other", source_root="/other",
                          entry_path="index.html", format="html", files={"index.html": "text/html"})
    with pytest.raises(Conflict):
        registry.update_metadata("demo", title="Changed", expected_revision=2)
    registry.update_metadata("demo", title="Changed", expected_revision=1)
    assert registry.get("demo")["title"] == "Changed"
    assert len(registry.get("demo")["files"]) == 2
    registry.replace_files("demo", source_root="/new", entry_path="report.md", format="markdown",
                           files={"report.md": "text/markdown"}, expected_revision=2)
    assert registry.get("demo")["files"] == {"report.md": "text/markdown"}
    assert registry.get("demo")["revision"] == 3
    registry.deregister("demo", expected_revision=3)
    assert registry.list() == []
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT count(*) FROM artifact_files").fetchone()[0] == 0


def test_missing_entry_rolls_back_registration(registry):
    with pytest.raises(sqlite3.IntegrityError):
        registry.register(slug="demo", title="Demo", description="Description", source_root="/source",
                          entry_path="missing.html", format="html", files={"other.html": "text/html"})
    assert registry.list() == []


def test_incompatible_schema_is_not_modified(registry, path):
    with sqlite3.connect(path) as db:
        db.execute("UPDATE alembic_version SET version_num='future'")
    before = path.read_bytes()

    with pytest.raises(SchemaError, match="setup"):
        Registry(path).check_schema()
    assert path.read_bytes() == before
