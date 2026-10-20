import json
import tempfile
import unittest
from pathlib import Path

from battuta_memory.contracts import Scope, Selector, RememberRequest
from battuta_memory.scope import resolve_scope, resolve_selector


class ScopeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in ("atlas", "beacon"):
            folder = self.root / name
            (folder / "code").mkdir(parents=True)
            (folder / "project.yaml").write_text(f"version: 1\nproject:\n  name: {name}\n  path: {folder}/code\n")

    def test_explicit_multi_project_membership(self):
        self.assertEqual(resolve_scope(Scope.model_validate({"global": False, "projects": ["beacon", "atlas", "atlas"]}), self.root), ["proj:atlas", "proj:beacon"])

    def test_global_and_missing_selection(self):
        self.assertEqual(resolve_scope(Scope.model_validate({"global": True}), self.root), ["scope:global"])
        selected = resolve_selector(Selector(), self.root)
        self.assertEqual(selected.tags, ["scope:global"])
        self.assertTrue(selected.warnings)

    def test_current_plus_global(self):
        (self.root / ".config.json").write_text(json.dumps({"currentProject": "atlas"}))
        self.assertEqual(resolve_selector(Selector(), self.root).tags, ["proj:atlas", "scope:global"])

    def test_invalid_scope_rejected(self):
        for scope in ({"global": True, "projects": ["atlas"]}, {"global": False}, {}, {"global": False, "projects": ["../secret"]}):
            with self.subTest(scope=scope), self.assertRaises(ValueError):
                Scope.model_validate(scope)

    def test_unknown_project_and_corrupt_registry_are_errors(self):
        with self.assertRaises(ValueError):
            resolve_scope(Scope.model_validate({"global": False, "projects": ["unknown"]}), self.root)
        (self.root / ".config.json").write_text("not json")
        with self.assertRaises(ValueError):
            resolve_selector(Selector(), self.root)

    def test_reserved_tags_cannot_widen_scope(self):
        for tag in ("proj:beacon", "SCOPE:global", "kind:decision"):
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                RememberRequest(content="note", scope={"global": True}, tags=[tag])
        req = RememberRequest(content="note", scope={"global": True}, tags=[" Work ", "work"])
        self.assertEqual(req.tags, ["work"])

    def test_symlink_registration_refused(self):
        (self.root / "alias").symlink_to(self.root / "atlas", target_is_directory=True)
        with self.assertRaises(ValueError):
            resolve_scope(Scope.model_validate({"global": False, "projects": ["alias"]}), self.root)
