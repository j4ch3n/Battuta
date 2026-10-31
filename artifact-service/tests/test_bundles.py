import json
import os
import sqlite3
import tempfile
import unittest
from contextlib import contextmanager
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from click.testing import CliRunner

from battuta_artifacts.cli import main
from battuta_artifacts.registry import Registry, migrate


class BundleFixture(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name).resolve()
        self.environment = patch.dict(os.environ, {"HOME": str(self.home), "BATTUTA_ARTIFACT_DB": str(self.home / "registry.db"),
                                                  "BATTUTA_ARTIFACT_BASE_URL": "", "LINEAR_API_TOKEN": ""})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.project = self.home / ".battuta/projects/procurement"
        (self.project / "code").mkdir(parents=True)
        (self.project / "project.yaml").write_text(json.dumps({"version": 1,
            "project": {"name": "procurement", "path": str(self.project / "code")},
            "linear": {"project_id": None, "team_id": None}, "github": {"repository": None}}))
        self.store = Registry(self.home / "registry.db")
        migrate(self.store.path)

    def init(self, *args):
        return CliRunner().invoke(main, ["init", "sizing", "--project", "procurement", "--title", 'VRAM <sizing> "guide"',
                                        "--description", "Evidence & assumptions", *args, "--json"])


class BundleTests(BundleFixture):
    def test_init_creates_real_project_draft_and_returns_actual_files_without_selection(self):
        result = self.init()
        self.assertEqual(result.exit_code, 0, result.output)
        payload = json.loads(result.output)
        item = payload["artifact"]
        directory = self.project / "artifacts/sizing"
        self.assertEqual(payload["directory"], str(directory))
        self.assertEqual(item["status"], "draft")
        self.assertEqual(item["template"], "report")
        self.assertNotIn("url", item)
        self.assertTrue(payload["guidance"])
        paths = {entry["path"] for entry in payload["files"]}
        self.assertEqual(paths, {str(p.relative_to(directory)) for p in directory.rglob("*") if p.is_file()})
        self.assertTrue(all(entry["purpose"] for entry in payload["files"]))
        self.assertNotIn("file-meta.json", paths)
        self.assertNotIn("file-meta.json", item["files"])
        self.assertIn("VRAM &lt;sizing&gt;", (directory / "index.html").read_text())
        self.assertFalse((self.project.parent / ".config.json").exists())

    def test_explicit_project_never_uses_or_changes_selection(self):
        state = self.project.parent / ".config.json"
        state.write_text('{"currentProject":"battuta"}')
        before = state.read_bytes()
        result = self.init("--slug", "procurement-sizing")
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertEqual(self.store.get("procurement-sizing")["source_root"], str(self.project / "artifacts/sizing"))
        self.assertEqual(state.read_bytes(), before)

    def test_invalid_input_and_missing_schema_never_create_bundle(self):
        for args in [("--project", "unknown"), ("--template", "../report"), ("--slug", "../bad"), ("--title", " ")]:
            with self.subTest(args=args):
                result = self.init(*args)
                self.assertNotEqual(result.exit_code, 0, result.output)
                self.assertFalse((self.project / "artifacts/sizing").exists())
                self.assertEqual(self.store.list(), [])
        result = CliRunner().invoke(main, ["init", "sizing", "--title", "Title", "--description", "Description", "--json"])
        self.assertNotEqual(result.exit_code, 0)
        self.store.path.unlink()
        self.assertEqual(self.init().exit_code, 5)
        self.assertFalse((self.project / "artifacts").exists())

    def test_existing_destination_duplicate_slug_and_symlink_parents_are_preserved(self):
        artifacts = self.project / "artifacts"
        outside = self.home / "outside"
        outside.mkdir()
        artifacts.symlink_to(outside, target_is_directory=True)
        self.assertNotEqual(self.init().exit_code, 0)
        self.assertEqual(list(outside.iterdir()), [])
        artifacts.unlink()
        target = artifacts / "sizing"
        target.mkdir(parents=True)
        (target / "private.txt").write_text("keep")
        self.assertNotEqual(self.init().exit_code, 0)
        self.assertEqual((target / "private.txt").read_text(), "keep")
        self.assertEqual(self.store.list(), [])

    def test_failed_registration_removes_only_new_bundle(self):
        with patch.object(Registry, "register", side_effect=sqlite3.OperationalError("commit failed")):
            result = self.init()
        self.assertEqual(result.exit_code, 5, result.output)
        self.assertFalse((self.project / "artifacts/sizing").exists())
        self.assertEqual(self.store.list(), [])

    def test_real_transaction_failure_rolls_back_row_and_new_files(self):
        connect = Registry.connect
        @contextmanager
        def fail_commit(store, *, write=False):
            with connect(store, write=write) as connection:
                yield connection
                if write:
                    raise sqlite3.OperationalError("commit failed")
        with patch.object(Registry, "connect", fail_commit):
            result = self.init()
        self.assertEqual(result.exit_code, 5, result.output)
        self.assertEqual(self.store.list(), [])
        self.assertFalse((self.project / "artifacts/sizing").exists())

    def test_post_insert_snapshot_failure_cannot_commit_an_incomplete_init(self):
        find = Registry._find
        def fail_snapshot(db, slug):
            if db.execute("SELECT 1 FROM artifacts WHERE slug=?", (slug,)).fetchone():
                raise sqlite3.OperationalError("cannot read result")
            return find(db, slug)
        with patch.object(Registry, "_find", side_effect=fail_snapshot):
            result = self.init()
        self.assertEqual(result.exit_code, 5)
        self.assertEqual(self.store.list(), [])
        self.assertFalse((self.project / "artifacts/sizing").exists())

    def test_bad_template_inventory_is_rejected_before_writes(self):
        from battuta_artifacts.bundles import initialize
        template = self.home / "report"
        template.mkdir()
        (template / "index.html").write_text("<h1>{{ title }}</h1>")
        entry = {"path": "index.html", "purpose": "Example", "serve": True}
        cases = [[], [entry, entry], [{**entry, "path": "../outside"}], [{**entry, "purpose": " "}],
                 [{**entry, "serve": "yes"}], [{**entry, "path": "missing.html"}],
                 [{**entry, "path": "file-meta.json"}]]
        for files in cases:
            with self.subTest(files=files):
                (template / "file-meta.json").write_text(json.dumps({"entry": "index.html", "files": files}))
                with self.assertRaises(Exception):
                    initialize(self.store, project="procurement", name="sizing", slug="sizing", template="report",
                               title="Title", description="Description", scaffolds=template.parent)
                self.assertFalse((self.project / "artifacts").exists())
        (template / "file-meta.json").write_text(json.dumps({"entry": "index.html", "files": [entry]}))
        (template / "unlisted.js").write_text("private")
        with self.assertRaisesRegex(Exception, "inventory"):
            initialize(self.store, project="procurement", name="sizing", slug="sizing", template="report",
                       title="Title", description="Description", scaffolds=self.home)

    def test_concurrent_initialization_has_one_winner(self):
        from battuta_artifacts.bundles import initialize
        def create():
            try:
                return initialize(self.store, project="procurement", name="sizing", slug="sizing", template="report",
                                  title="Sizing", description="VRAM")
            except Exception as exc:
                return exc
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: create(), range(2)))
        self.assertEqual(sum(isinstance(result, dict) for result in results), 1)
        self.assertEqual(len(self.store.list()), 1)
        self.assertTrue((self.project / "artifacts/sizing/index.html").is_file())

    def test_human_output_includes_directory_status_and_annotated_tree(self):
        result = CliRunner().invoke(main, ["init", "sizing", "--project", "procurement", "--title", "Title with spaces",
                                          "--description", "Description"])
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn(str(self.project / "artifacts/sizing"), result.output)
        self.assertIn("draft", result.output)
        self.assertIn("index.html", result.output)
        self.assertIn("──", result.output)
