import sqlite3
import tempfile
import unittest
from pathlib import Path


class RegistryTests(unittest.TestCase):
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
