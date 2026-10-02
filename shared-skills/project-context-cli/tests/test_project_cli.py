"""CLI argument contracts and end-to-end current-project workflows."""

from click.testing import CliRunner

from battuta_project.cli import main
from project_fixtures import ProjectTestCase


class CliTests(ProjectTestCase):
    def setUp(self):
        super().setUp()
        self.runner = CliRunner()

    def invoke(self, *args):
        result = self.runner.invoke(main, args)
        self.assertEqual(result.exit_code, 0, result.output)
        return result.output

    def test_init_and_switch_outputs_use_bundled_templates(self):
        output = self.invoke("init", "https://github.com/team/harbor-web")
        self.assertIn("Initialized project: harbor-web", output)
        self.assertIn("~/.battuta/projects/harbor-web/code", output)
        self.assertIn("Current project: harbor-web", output)
        output = self.invoke("switch", "atlas-api")
        self.assertIn("Current project: atlas-api", output)
        self.assertIn("~/.battuta/projects/atlas-api/code", output)

    def test_memory_workflow_uses_current_project_and_indexes(self):
        self.assertIn("line 1", self.invoke("memory", "append", "  First  "))
        self.invoke("memory", "append", "Second")
        self.assertEqual(self.invoke("memory", "get"), "1: First\n2: Second\n")
        self.invoke("memory", "replace", "2", " Revised ")
        self.assertEqual(self.invoke("memory", "get"), "1: First\n2: Revised\n")
        self.invoke("memory", "replaceAll", " Clean \n\n Reconciled ")
        self.assertEqual(self.invoke("memory", "get"), "1: Clean\n2: Reconciled\n")
        self.invoke("init", "https://github.com/team/harbor-web")
        self.assertIn("No memory", self.invoke("memory", "get"))
        self.invoke("memory", "append", "Harbor")
        self.invoke("switch", "atlas-api")
        self.assertEqual(self.invoke("memory", "get"), "1: Clean\n2: Reconciled\n")

    def test_explain_rejects_project_argument_and_uses_current_checkout(self):
        self.file("README.md")
        self.assertIn("Project Root: ~/.battuta/projects/atlas-api/code", self.invoke("explain"))
        result = self.runner.invoke(main, ["explain", "atlas-api"])
        self.assertNotEqual(result.exit_code, 0)

    def test_missing_current_project_and_invalid_indexes_are_readable_errors(self):
        self.registry.state_path.unlink()
        for args in (["explain"], ["memory", "get"], ["memory", "append", "entry"]):
            with self.subTest(args=args):
                result = self.runner.invoke(main, args)
                self.assertNotEqual(result.exit_code, 0)
                self.assertIn("Error:", result.output)
                self.assertIn("switch", result.output)
        self.invoke("switch", "atlas-api")
        self.invoke("memory", "append", "First")
        for index in ("0", "2", "not-a-number"):
            result = self.runner.invoke(main, ["memory", "replace", index, "changed"])
            self.assertNotEqual(result.exit_code, 0)
        self.assertEqual(self.invoke("memory", "get"), "1: First\n")
