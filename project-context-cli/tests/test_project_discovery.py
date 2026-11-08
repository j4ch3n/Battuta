"""Filesystem project discovery without workspace changes."""

from click.testing import CliRunner
import json
import os
import shutil
from unittest.mock import patch

from battuta_project.cli import main
from battuta_project.models import ProjectList
from battuta_project.presentation import render
from linear_fixtures import linear_http
from project_fixtures import ProjectTestCase


class DiscoveryTests(ProjectTestCase):
    def setUp(self):
        super().setUp()
        self.runner = CliRunner()
        token = patch.dict(os.environ, {"LINEAR_API_TOKEN": "test-token"})
        token.start()
        self.addCleanup(token.stop)

    def invoke(self, *args):
        result = self.runner.invoke(main, args)
        self.assertEqual(result.exit_code, 0, result.output)
        return result.output

    def test_list_sorts_projects_and_renders_both_home_relative_paths(self):
        self.registry.init("harbor-web", github="https://github.com/team/harbor-web")
        self.registry.init("aardvark", github="https://github.com/team/aardvark")
        with linear_http() as requests:
            output = self.invoke("list")
        self.assertEqual(output, (
            "1. **aardvark**\n"
            "   Project Root: ~/.battuta/projects/aardvark\n"
            "   Code: ~/.battuta/projects/aardvark/code\n"
            "2. **atlas-api**\n"
            "   Project Root: ~/.battuta/projects/atlas-api\n"
            "   Code: ~/.battuta/projects/atlas-api/code\n"
            "3. **harbor-web**\n"
            "   Project Root: ~/.battuta/projects/harbor-web\n"
            "   Code: ~/.battuta/projects/harbor-web/code\n"
        ))
        self.assertEqual(requests, [])

    def test_discovery_requires_project_yaml(self):
        (self.registry.root / "unregistered").mkdir()
        (self.registry.root / ".hidden").mkdir()
        (self.registry.root / "notes.txt").write_text("Notes")
        (self.registry.root / "alias").symlink_to(self.project.root, target_is_directory=True)
        self.assertIn("1. **atlas-api**", self.invoke("list"))
        self.assertNotIn("2.", self.invoke("list"))
        self.assertFalse((self.registry.root / ".config.json").exists())

    def test_list_empty_or_missing_registry_does_not_create_state(self):
        shutil.rmtree(self.registry.root)
        for exists in (False, True):
            with self.subTest(registry_exists=exists):
                if exists:
                    self.registry.root.mkdir()
                output = self.invoke("list")
                self.assertIn("No registered projects" if exists else "No Battuta project store has been initialized", output)
                self.assertIn("battuta-project init <project-name>", output)
                self.assertEqual(self.registry.root.exists(), exists)
                self.assertFalse((self.registry.root / ".config.json").exists())

    def test_list_reports_invalid_registration_without_mutation(self):
        (self.project.root / "project.yaml").write_text("invalid: true")
        result = self.runner.invoke(main, ["list"])
        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("project.yaml", result.output)
        self.assertEqual((self.project.root / "project.yaml").read_text(), "invalid: true")

    def test_list_json_is_complete_and_non_mutating(self):
        for name in ("Atlas", "my project", "项目", "global"):
            self.registry.init(name)
        before = {str(p): p.read_bytes() for p in self.home.rglob("*") if p.is_file()}
        self.assertEqual(json.loads(self.invoke("list", "--json")), {
            "projects": ["Atlas", "atlas-api", "global", "my project", "项目"],
        })
        self.assertEqual({str(p): p.read_bytes() for p in self.home.rglob("*") if p.is_file()}, before)

    def test_list_json_empty_registry(self):
        shutil.rmtree(self.registry.root)
        for exists in (False, True):
            with self.subTest(exists=exists):
                if exists:
                    self.registry.root.mkdir()
                self.assertEqual(json.loads(self.invoke("list", "--json")), {"projects": []})
                self.assertEqual(self.registry.root.exists(), exists)
                self.assertFalse((self.registry.root / ".config.json").exists())

    def test_list_json_rejects_invalid_registration(self):
        (self.project.root / "project.yaml").write_text("invalid: true")
        result = self.runner.invoke(main, ["list", "--json"])
        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("project.yaml", result.output)

    def test_list_rejects_root_override(self):
        root = self.home / "custom"
        result = self.runner.invoke(main, ["list", "--json", "--root", str(root)])
        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("No such option", result.output)
        self.assertFalse(root.exists())

    def test_list_rejects_unsafe_markers_or_broken_checkouts(self):
        path = self.project.root / "project.yaml"
        config = path.read_bytes()
        for state in ("directory", "symlink", "broken-symlink", "malformed", "missing-checkout", "symlink-checkout"):
            with self.subTest(state=state):
                if state == "directory":
                    path.unlink()
                    path.mkdir()
                elif state in ("symlink", "broken-symlink"):
                    path.unlink()
                    path.symlink_to(self.project.root / ("SUMMARY.md" if state == "symlink" else "absent"))
                elif state == "malformed":
                    path.write_text("not: valid: yaml")
                else:
                    self.project.code.rmdir()
                    if state == "symlink-checkout":
                        self.project.code.symlink_to(self.home, target_is_directory=True)
                result = self.runner.invoke(main, ["list", "--json"])
                self.assertNotEqual(result.exit_code, 0)
                self.assertIn(str(self.project.root), result.output)
                if path.is_symlink() or path.is_file():
                    path.unlink()
                else:
                    path.rmdir()
                path.write_bytes(config)
                if self.project.code.is_symlink():
                    self.project.code.unlink()
                self.project.code.mkdir(exist_ok=True)

    def test_list_preserves_absolute_paths_outside_home(self):
        with patch("pathlib.Path.home", return_value=self.home / "different-home"):
            output = render("list.md.j2", ProjectList(projects=[self.project]))
        self.assertEqual(output, (
            "1. **atlas-api**\n"
            f"   Project Root: {self.project.root}\n"
            f"   Code: {self.project.code}"
        ))
        self.assertNotIn("~", output)

    def test_discovery_commands_reject_project_arguments(self):
        for command in ("list",):
            with self.subTest(command=command):
                result = self.runner.invoke(main, [command, "atlas-api"])
                self.assertNotEqual(result.exit_code, 0)
                self.assertIn("unexpected extra argument", result.output)

    def test_named_project_errors_distinguish_store_empty_and_unknown(self):
        for state in ("missing store", "empty registry", "unknown"):
            with self.subTest(state=state):
                if self.registry.root.exists():
                    shutil.rmtree(self.registry.root)
                if state == "empty registry":
                    self.registry.root.mkdir()
                elif state == "unknown":
                    self.registry.init("atlas-api")
                before = sorted(self.home.rglob("*"))
                result = self.runner.invoke(main, ["explain", "Battuta"])
                self.assertNotEqual(result.exit_code, 0)
                expected = {
                    "missing store": "No Battuta project store has been initialized",
                    "empty registry": "No registered projects",
                    "unknown": "Project 'Battuta' is not registered",
                }[state]
                self.assertIn(expected, result.output)
                self.assertIn("battuta-project init <project-name>", result.output)
                if state == "unknown":
                    self.assertIn("battuta-project list", result.output)
                self.assertEqual(sorted(self.home.rglob("*")), before)
