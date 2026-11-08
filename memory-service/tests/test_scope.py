import os
import unittest
from unittest.mock import patch

from battuta_memory.config import MemoryConfig
from battuta_memory.contracts import Selector, RememberRequest
from battuta_memory.scope import resolve_scope, resolve_selector, scope_from_projects, projects_from_scope


class ScopeTests(unittest.TestCase):
    def test_explicit_multi_project_membership(self):
        for names, expected in [
            (["Beacon", "Atlas", "Atlas"], ["atlas", "beacon"]),
            (["my project", "项目", "X" * 65], ["my project", "x" * 65, "项目"]),
            (["one,two", "%2c"], ["%2c", "one,two"]),
        ]:
            with self.subTest(names=names):
                request = RememberRequest(content="note", projects=names)
                self.assertEqual(request.projects, expected)
                scope = scope_from_projects(request.projects)
                self.assertEqual(projects_from_scope(scope), expected)
                self.assertEqual(len(resolve_scope(scope)), len(expected))

    def test_explicit_selection_only(self):
        self.assertEqual(resolve_selector(Selector(selector="global")).tags, ["scope:global"])
        self.assertIsNone(resolve_selector(Selector(selector="all")).tags)
        self.assertEqual(resolve_selector(Selector(selector="projects", projects=["Atlas"])).tags,
            ["proj:atlas", "scope:global"])
        for args in ({}, {"selector": "current"}, {"selector": "projects"},
                     {"selector": "projects", "projects": ["global"]}):
            with self.subTest(args=args), self.assertRaises(ValueError):
                Selector(**args)

    def test_invalid_membership_structure(self):
        for names in ([], ["global", "atlas"], ["GLOBAL", "Atlas"], [42], ["x"] * 101):
            with self.subTest(names=names), self.assertRaises(ValueError):
                RememberRequest(content="note", projects=names)
        for args in ({}, {"scope": {"global": True}}):
            with self.subTest(args=args), self.assertRaises(ValueError):
                RememberRequest(content="note", **args)

    def test_registry_environment_has_no_effect(self):
        for root in ("relative", "/missing/projects"):
            with self.subTest(root=root), patch.dict(os.environ, {"BATTUTA_PROJECTS_ROOT": root}):
                self.assertFalse(hasattr(MemoryConfig.from_env(), "registry_root"))
                self.assertEqual(resolve_scope(scope_from_projects(["unknown"])), ["proj:unknown"])

    def test_reserved_tags_cannot_widen_scope(self):
        for tag in ("proj:beacon", "SCOPE:global", "kind:decision"):
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                RememberRequest(content="note", projects=["global"], tags=[tag])
        self.assertEqual(RememberRequest(content="note", projects=["global"], tags=[" Work ", "work"]).tags, ["work"])
