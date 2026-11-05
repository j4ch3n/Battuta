"""Project discovery and selection reporting without workspace changes."""

from click.testing import CliRunner
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
        selection = self.registry.state_path.read_bytes()
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
        self.assertEqual(self.registry.state_path.read_bytes(), selection)
        self.assertEqual(requests, [])

    def test_list_does_not_require_selection_and_ignores_non_project_entries(self):
        self.registry.state_path.unlink()
        (self.registry.root / ".hidden").mkdir()
        (self.registry.root / "notes.txt").write_text("Notes")
        (self.registry.root / "alias").symlink_to(self.project.root, target_is_directory=True)
        self.assertIn("1. **atlas-api**", self.invoke("list"))
        self.assertNotIn("2.", self.invoke("list"))
        self.assertFalse(self.registry.state_path.exists())

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
                self.assertFalse(self.registry.state_path.exists())

    def test_list_reports_invalid_registration_without_changing_selection(self):
        selection = self.registry.state_path.read_bytes()
        (self.project.root / "project.yaml").write_text("invalid: true")
        result = self.runner.invoke(main, ["list"])
        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("project.yaml", result.output)
        self.assertEqual(self.registry.state_path.read_bytes(), selection)

    def test_list_preserves_absolute_paths_outside_home(self):
        with patch("pathlib.Path.home", return_value=self.home / "different-home"):
            output = render("list.md.j2", ProjectList(projects=[self.project]))
        self.assertEqual(output, (
            "1. **atlas-api**\n"
            f"   Project Root: {self.project.root}\n"
            f"   Code: {self.project.code}"
        ))
        self.assertNotIn("~", output)

    def test_current_reads_selection_without_loading_checkout_or_calling_linear(self):
        selection = self.registry.state_path.read_bytes()
        (self.project.root / "project.yaml").unlink()
        self.project.code.rmdir()
        with linear_http() as requests:
            self.assertEqual(self.invoke("current"), "Current Project: atlas-api\n")
        self.assertEqual(self.registry.state_path.read_bytes(), selection)
        self.assertEqual(requests, [])

    def test_current_reports_switch_and_missing_selection(self):
        self.registry.init("harbor-web", github="https://github.com/team/harbor-web")
        self.assertEqual(self.invoke("current"), "Current Project: harbor-web\n")
        self.registry.state_path.unlink()
        result = self.runner.invoke(main, ["current"])
        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("No current project", result.output)
        self.assertIn("switch", result.output)
        self.assertFalse(self.registry.state_path.exists())

    def test_discovery_commands_reject_project_arguments(self):
        for command in ("list", "current"):
            with self.subTest(command=command):
                result = self.runner.invoke(main, [command, "atlas-api"])
                self.assertNotEqual(result.exit_code, 0)
                self.assertIn("unexpected extra argument", result.output)

    def test_current_distinguishes_uninitialized_empty_and_unselected(self):
        for state in ("missing parent", "missing store", "empty registry", "unselected"):
            with self.subTest(state=state):
                if self.registry.root.parent.exists():
                    shutil.rmtree(self.registry.root.parent)
                if state == "missing store":
                    self.registry.root.parent.mkdir()
                elif state == "empty registry":
                    self.registry.root.mkdir(parents=True)
                elif state == "unselected":
                    self.registry.init("atlas-api")
                    self.registry.state_path.unlink()
                before = sorted(self.home.rglob("*"))
                result = self.runner.invoke(main, ["current"])
                self.assertNotEqual(result.exit_code, 0)
                expected = {
                    "missing parent": "No Battuta project store has been initialized",
                    "missing store": "No Battuta project store has been initialized",
                    "empty registry": "No registered projects",
                    "unselected": "No current project is selected",
                }[state]
                self.assertIn(expected, result.output)
                self.assertIn("battuta-project init <project-name>", result.output)
                if state == "unselected":
                    self.assertIn("battuta-project switch <project-name>", result.output)
                self.assertNotIn("ENOENT", result.output)
                self.assertEqual(sorted(self.home.rglob("*")), before)

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
                result = self.runner.invoke(main, ["switch", "Battuta"])
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
