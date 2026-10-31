import sqlite3
import tempfile
import unittest
from pathlib import Path


class RegistryTests(unittest.TestCase):
    def test_upgrade_preserves_published_records_and_defaults_new_rows_to_draft(self):
        from alembic import command
        from sqlalchemy import URL, create_engine
        from battuta_artifacts.registry import Registry, migrate, migration_config

        engine = create_engine(URL.create("sqlite", database=str(self.path)))
        with engine.begin() as connection:
            config = migration_config()
            config.attributes["connection"] = connection
            command.upgrade(config, "0001_registry")
            connection.exec_driver_sql("INSERT INTO artifacts VALUES ('old', 'old', 'Old', 'Existing', '/source', 'index.html', 'html', 1, 'then', 'then')")
            connection.exec_driver_sql("INSERT INTO artifact_files VALUES ('old', 'index.html', 'text/html')")
        engine.dispose()
        migrate(self.path)
        registry = Registry(self.path)
        self.assertEqual(registry.get("old")["status"], "published")
        item = registry.register(slug="new", title="New", description="Draft", source_root="/source",
                                 entry_path="index.html", format="html", files={"index.html": "text/html"},
                                 template="report", project="procurement", name="new")
        self.assertEqual(item["status"], "draft")
        self.assertEqual(item["template"], "report")
        self.assertEqual([row["slug"] for row in registry.list(published_only=True)], ["old"])
        with sqlite3.connect(self.path) as db:
            with self.assertRaises(sqlite3.IntegrityError):
                db.execute("UPDATE artifacts SET status='private'")

    def test_publication_is_atomic_idempotent_and_revision_guarded(self):
        from battuta_artifacts.registry import Conflict, Registry, migrate
        migrate(self.path)
        registry = Registry(self.path)
        item = registry.register(slug="draft", title="Draft", description="Hidden", source_root="/source",
                                 entry_path="index.html", format="html", files={"index.html": "text/html"})
        item = registry.publish("draft", files={**item["files"], "plot.json": "application/json"}, expected_revision=1)
        self.assertEqual((item["status"], item["revision"]), ("published", 2))
        self.assertIn("plot.json", item["files"])
        self.assertEqual(registry.publish("draft", files=item["files"], expected_revision=2), item)
        with self.assertRaises(Conflict):
            registry.publish("draft", files=item["files"], expected_revision=1)

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / "registry.sqlite3"

    def test_schema_requires_explicit_setup_and_setup_is_idempotent(self):
        from battuta_artifacts.registry import Registry, SchemaError, migrate

        with self.assertRaisesRegex(SchemaError, "setup"):
            Registry(self.path).check_schema()
        self.assertFalse(self.path.exists())
        migrate(self.path)
        migrate(self.path)
        Registry(self.path).check_schema()

    def test_register_conflict_update_and_deregister(self):
        from battuta_artifacts.registry import Conflict, Registry, migrate

        migrate(self.path)
        registry = Registry(self.path)
        item = registry.register(slug="demo", title="Demo", description="Walkthrough",
                                 source_root="/source", entry_path="index.html", format="html",
                                 files={"index.html": "text/html", "app.js": "text/javascript"})
        self.assertEqual(item["revision"], 1)
        self.assertEqual(len(registry.list()), 1)
        with self.assertRaises(Conflict):
            registry.register(slug="demo", title="Other", description="Other", source_root="/other",
                              entry_path="index.html", format="html", files={"index.html": "text/html"})
        with self.assertRaises(Conflict):
            registry.update_metadata("demo", title="Changed", expected_revision=2)
        registry.update_metadata("demo", title="Changed", expected_revision=1)
        self.assertEqual(registry.get("demo")["title"], "Changed")
        self.assertEqual(len(registry.get("demo")["files"]), 2)
        registry.replace_files("demo", source_root="/new", entry_path="report.md", format="markdown",
                               files={"report.md": "text/markdown"}, expected_revision=2)
        self.assertEqual(registry.get("demo")["files"], {"report.md": "text/markdown"})
        self.assertEqual(registry.get("demo")["revision"], 3)
        registry.deregister("demo", expected_revision=3)
        self.assertEqual(registry.list(), [])
        with sqlite3.connect(self.path) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM artifact_files").fetchone()[0], 0)

    def test_missing_entry_rolls_back_registration(self):
        from battuta_artifacts.registry import Registry, migrate

        migrate(self.path)
        registry = Registry(self.path)
        with self.assertRaises(sqlite3.IntegrityError):
            registry.register(slug="demo", title="Demo", description="Description", source_root="/source",
                              entry_path="missing.html", format="html", files={"other.html": "text/html"})
        self.assertEqual(registry.list(), [])

    def test_incompatible_schema_is_not_modified(self):
        from battuta_artifacts.registry import Registry, SchemaError, migrate

        migrate(self.path)
        with sqlite3.connect(self.path) as db:
            db.execute("UPDATE alembic_version SET version_num='future'")
        before = self.path.read_bytes()
        with self.assertRaisesRegex(SchemaError, "setup"):
            Registry(self.path).check_schema()
        self.assertEqual(self.path.read_bytes(), before)
