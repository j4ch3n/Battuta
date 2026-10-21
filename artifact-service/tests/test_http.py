import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from battuta_artifacts.registry import Registry, SchemaError, migrate


class HttpFixture(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.db = self.root / "registry.sqlite3"
        self.source = self.root / "source"
        (self.source / "js").mkdir(parents=True)
        (self.source / "index.html").write_text('<script src="js/app.js"></script>')
        (self.source / "js/app.js").write_text("console.log('live')")
        (self.source / "secret.txt").write_text("private")
        migrate(self.db)
        self.registry = Registry(self.db)
        self.registry.register(slug="demo", title="Demo", description="Description", source_root=str(self.source),
                               entry_path="index.html", format="html",
                               files={"index.html": "text/html", "js/app.js": "text/javascript"})

    def client(self):
        from battuta_artifacts.app import create_app
        client = TestClient(create_app(self.db))
        self.addCleanup(client.close)
        return client


class HttpTests(HttpFixture):
    def test_concurrent_replacement_never_combines_root_and_allowlist_revisions(self):
        # WAL lets the writer commit while the reader retains an older snapshot.
        with sqlite3.connect(self.db) as db:
            db.execute("PRAGMA journal_mode=WAL")
        (self.source / "private.js").write_text("never registered from this root")
        new_root = self.root / "new-source"
        new_root.mkdir()
        (new_root / "index.html").write_text("New entry")
        (new_root / "private.js").write_text("explicitly published from new root")
        find = Registry._find
        replace_once = [True]

        def replace_after_metadata(db, slug):
            item = find(db, slug)
            if replace_once[0]:
                replace_once[0] = False
                self.registry.replace_files("demo", source_root=str(new_root), entry_path="index.html", format="html",
                                            files={"index.html": "text/html", "private.js": "text/javascript"})
            return item

        client = self.client()
        # Interleave real registry replacement exactly between metadata and files.
        with patch.object(Registry, "_find", side_effect=replace_after_metadata):
            response = client.get("/artifacts/a/demo/private.js")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(client.get("/artifacts/a/demo/private.js").text, "explicitly published from new root")

    def test_entry_bundle_live_changes_and_deregistration(self):
        client = self.client()
        response = client.get("/artifacts/a/demo", follow_redirects=False)
        self.assertEqual(response.status_code, 307)
        self.assertTrue(response.headers["location"].endswith("/demo/"))
        response = client.get("/artifacts/a/demo/")
        self.assertEqual(response.status_code, 200)
        self.assertIn('src="js/app.js"', response.text)
        self.assertEqual(response.headers["content-type"], "text/html; charset=utf-8")
        response = client.get("/artifacts/a/demo/js/app.js")
        self.assertEqual(response.status_code, 200)
        self.assertIn("javascript", response.headers["content-type"])
        (self.source / "js/app.js").write_text("changed source")
        self.assertEqual(client.get("/artifacts/a/demo/js/app.js").text, "changed source")
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.registry.deregister("demo")
        self.assertEqual(client.get("/artifacts/a/demo/").status_code, 404)
        self.assertTrue((self.source / "index.html").exists())

    def test_no_unlisted_or_traversal_or_absolute_path_access(self):
        client = self.client()
        for path in ["secret.txt", "%2e%2e/secret.txt", "%252e%252e/secret.txt", "%2Fetc/passwd", "js//app.js",
                     "js/%2e%2e/secret.txt", "index.html/", "js%5capp.js"]:
            with self.subTest(path=path):
                response = client.get(f"/artifacts/a/demo/{path}")
                self.assertEqual(response.status_code, 404)
                self.assertNotIn(str(self.source), response.text)

    def test_missing_file_and_post_registration_symlinks_are_not_served(self):
        client = self.client()
        script = self.source / "js/app.js"
        script.unlink()
        self.assertEqual(client.get("/artifacts/a/demo/js/app.js").status_code, 404)
        script.symlink_to(self.source / "secret.txt")
        self.assertEqual(client.get("/artifacts/a/demo/js/app.js").status_code, 404)
        script.unlink()
        (self.source / "js").rmdir()
        outside = self.root / "outside"
        outside.mkdir()
        (outside / "app.js").write_text("secret")
        (self.source / "js").symlink_to(outside, target_is_directory=True)
        self.assertEqual(client.get("/artifacts/a/demo/js/app.js").status_code, 404)

    def test_replaced_root_and_fifo_are_not_served(self):
        client = self.client()
        moved = self.root / "moved"
        self.source.rename(moved)
        self.source.symlink_to(moved, target_is_directory=True)
        self.assertEqual(client.get("/artifacts/a/demo/").status_code, 404)
        self.source.unlink()
        moved.rename(self.source)
        script = self.source / "js/app.js"
        script.unlink()
        os.mkfifo(script)
        self.assertEqual(client.get("/artifacts/a/demo/js/app.js").status_code, 404)

    def test_startup_never_creates_or_upgrades_registry(self):
        from battuta_artifacts.app import create_app

        missing = self.root / "missing.sqlite3"
        with self.assertRaisesRegex(SchemaError, "setup"):
            with TestClient(create_app(missing)):
                pass
        self.assertFalse(missing.exists())
        before = self.db.read_bytes()
        with TestClient(create_app(self.db)) as client:
            self.assertEqual(client.get("/artifacts/a/demo/").status_code, 200)
        self.assertEqual(self.db.read_bytes(), before)
