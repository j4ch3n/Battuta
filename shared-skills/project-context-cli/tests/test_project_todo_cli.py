"""Bot-facing ordered queue commands and scope selection."""

from datetime import datetime, timezone
import json
import os
from unittest.mock import patch

from click.testing import CliRunner

from battuta_project.cli import main
from project_fixtures import ProjectTestCase


class TodoCliTests(ProjectTestCase):
    def setUp(self):
        super().setUp()
        self.runner = CliRunner()
        env = patch.dict(os.environ, {"AGENT_ROLE": "pm", "LINEAR_API_TOKEN": "test-token"})
        env.start()
        self.addCleanup(env.stop)

    def call(self, *args, scope="project", second=0, role="pm"):
        with patch.dict(os.environ, {"AGENT_ROLE": role}):
            with patch("battuta_project.todos.datetime", wraps=datetime) as clock:
                clock.now.return_value = datetime(2026, 10, 23, 12, 0, second, tzinfo=timezone.utc)
                return self.runner.invoke(main, ["todo", "--scope", scope, *args])

    def success(self, *args, **kwargs):
        result = self.call(*args, **kwargs)
        self.assertEqual(result.exit_code, 0, result.output)
        return result.output

    def assert_explained_failure(self, result):
        self.assertNotEqual(result.exit_code, 0)
        message = result.output.partition("Error: ")[2].strip()
        _, separator, explanation = message.partition(": ")
        self.assertGreater(len(explanation if separator else message), 50, result.output)

    def test_next_commands_and_remaining_update(self):
        output = self.success("create", "--item", "First", "--item", "Second", "--item", "Last")
        self.assertIn("Next: #1 First", output)
        self.assertIn("atlas-api", output)
        self.success("done", "--rational", "Verified first step")
        self.success("cancel", "--rational", "Owner dropped the second step")
        output = self.success("update-todo", "--item", "Revised", "--item", "Extra")
        self.assertIn("Next: #3 Revised", output)
        path = self.project.root / "todos" / "todo-pm-20261023T120000Z.jsonl"
        self.assertEqual([json.loads(line) for line in path.read_text().splitlines()], [
            {"id": 1, "status": "done", "description": "First", "rational": "Verified first step"},
            {"id": 2, "status": "cancelled", "description": "Second", "rational": "Owner dropped the second step"},
            {"id": 3, "status": "todo", "description": "Revised", "rational": ""},
            {"id": 4, "status": "todo", "description": "Extra", "rational": ""},
        ])
        output = self.success("list")
        self.assertIn("Revised", output)
        self.assertIn("Verified first step", output)
        self.assertIn("Owner dropped the second step", output)
        for args in (("done", "4"), ("delete", "3"), ("update", "3"), ("replace",)):
            with self.subTest(args=args):
                self.assertNotEqual(self.call(*args).exit_code, 0)
        self.success("done", "--rational", "Revised step checked")
        self.assertIn("No remaining TODO items.", self.success("cancel", "--rational", "Extra step not needed"))
        for args in (("done", "--rational", "Checked"), ("cancel", "--rational", "Not needed"), ("update-todo", "--item", "New")):
            with self.subTest(args=args):
                result = self.call(*args)
                self.assert_explained_failure(result)

    def test_creation_blocks_until_owner_approved_force(self):
        self.success("create", "--item", "Existing work")
        path = self.project.root / "todos" / "todo-pm-20261023T120000Z.jsonl"
        before = path.read_bytes()
        blocked = self.call("create", "--item", "Different work", second=1)
        self.assert_explained_failure(blocked)
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(len(list(path.parent.glob("*.jsonl"))), 1)
        output = self.success("create", "--force", "--item", "Different work", second=1)
        self.assertIn("todo-pm-20261023T120001Z.jsonl", output)
        self.assertEqual(path.read_bytes(), before)
        self.success("done", "--rational", "Different work verified")
        self.success("create", "--item", "Next task", second=2)

    def test_scopes_roles_and_projects_are_isolated(self):
        self.success("create", "--item", "PM project")
        self.assertNotIn("PM project", self.success("list", role="tl"))
        self.success("create", "--item", "TL project", role="tl")
        self.success("create", "--item", "PM general", scope="general")
        self.registry.init("other-project")
        self.assertNotIn("PM project", self.success("list"))
        self.assertIn("PM general", self.success("list", scope="general"))
        self.registry.switch("atlas-api")
        self.assertIn("PM project", self.success("list"))
        self.assertIn("TL project", self.success("list", role="tl"))

    def test_general_scope_needs_no_registry_or_selection(self):
        # Use a fresh home, not the registered-project fixture.
        home = self.home / "empty-home"
        home.mkdir()
        with patch("pathlib.Path.home", return_value=home):
            self.assertIn("No active TODO list", self.success("list", scope="general"))
            self.assertFalse((home / ".battuta").exists())
            self.success("create", "--item", "General task", scope="general")
            self.assertTrue((home / ".battuta/todos/todo-pm-20261023T120000Z.jsonl").is_file())
            self.assertFalse((home / ".battuta/projects").exists())
            result = self.call("list")
            self.assert_explained_failure(result)

    def test_invalid_input_and_missing_list_have_actionable_errors(self):
        self.assertIn("No active TODO list", self.success("list"))
        for args in (
            ("done", "--rational", "Checked"),
            ("cancel", "--rational", "Not needed"),
            ("update-todo", "--item", "Next"),
            ("create", "--item", " "),
        ):
            with self.subTest(args=args):
                result = self.call(*args)
                self.assert_explained_failure(result)
        result = self.call("list", role="engineer")
        self.assert_explained_failure(result)
        self.assertFalse((self.project.root / "todos").exists())

    def test_done_and_cancel_require_rational(self):
        self.success("create", "--item", "Next step")
        path = self.project.root / "todos" / "todo-pm-20261023T120000Z.jsonl"
        before = path.read_bytes()
        for command in ("done", "cancel"):
            for options in ((), ("--rational", ""), ("--rational", " \n ")):
                with self.subTest(command=command, options=options):
                    result = self.call(command, *options)
                    self.assertNotEqual(result.exit_code, 0)
                    self.assertIn("rational", result.output)
                    self.assertEqual(path.read_bytes(), before)
