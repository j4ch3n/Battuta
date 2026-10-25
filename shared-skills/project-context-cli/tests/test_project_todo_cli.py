"""Bot-facing ordered queue commands and scope selection."""

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
            return self.runner.invoke(main, ["todo", "--scope", scope, *args])

    def todo_path(self, *, scope="project", role="pm"):
        project = self.registry.current_name() if scope == "project" else None
        work_id = self.registry.current_work_id(project, role)
        directory = self.registry.root / project / "todos" if project else self.home / ".battuta/todos"
        return directory / f"todo-{role}-{work_id}.jsonl"

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
        path = self.todo_path()
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
        path = self.todo_path()
        before = path.read_bytes()
        blocked = self.call("create", "--item", "Different work", second=1)
        self.assert_explained_failure(blocked)
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(len(list(path.parent.glob("*.jsonl"))), 1)
        output = self.success("create", "--force", "--item", "Different work", second=1)
        self.assertIn(self.todo_path().name, output)
        self.assertEqual(path.read_bytes(), before)
        self.success("done", "--rational", "Different work verified")
        self.success("create", "--item", "Next task", second=2)

    def test_list_remain_preserves_ids_counts_and_stored_history(self):
        for scope in ("project", "general"):
            with self.subTest(scope=scope):
                self.success("list", "--remain", scope=scope)
                self.success("create", "--item", "Completed step", "--item", "Cancelled step", "--item", "Remaining step", scope=scope)
                self.success("done", "--rational", "Completion explanation", scope=scope)
                self.success("cancel", "--rational", "Cancellation explanation", scope=scope)
                directory = self.project.root / "todos" if scope == "project" else self.home / ".battuta/todos"
                path = self.todo_path(scope=scope)
                before = path.read_bytes()

                output = self.success("list", "--remain", scope=scope)
                self.assertIn("3. [todo] Remaining step", output)
                self.assertIn("Next: #3 Remaining step", output)
                self.assertIn("1 done, 1 cancelled, 1 remaining", output)
                for hidden in ("Completed step", "Cancelled step", "Completion explanation", "Cancellation explanation"):
                    self.assertNotIn(hidden, output)
                self.assertEqual(path.read_bytes(), before)

                full = self.success("list", scope=scope)
                for visible in ("Completed step", "Cancelled step", "Remaining step", "Completion explanation", "Cancellation explanation"):
                    self.assertIn(visible, full)

                self.success("done", "--rational", "Remaining step verified", scope=scope)
                output = self.success("list", "--remain", scope=scope)
                self.assertIn("No remaining TODO items.", output)
                self.assertIn("2 done, 1 cancelled, 0 remaining", output)
                self.assertNotIn("Remaining step", output)

    def test_list_next_item_follows_execution_order_without_mutating(self):
        for scope in ("project", "general"):
            with self.subTest(scope=scope):
                self.success("list", "--next", scope=scope)
                self.success("create", "--item", "Completed step", "--item", "Cancelled step", "--item", "Next step", "--item", "Later step", scope=scope)
                self.success("done", "--rational", "Completion explanation", scope=scope)
                self.success("cancel", "--rational", "Cancellation explanation", scope=scope)
                directory = self.project.root / "todos" if scope == "project" else self.home / ".battuta/todos"
                path = self.todo_path(scope=scope)
                before = path.read_bytes()

                output = self.success("list", "--next", scope=scope)
                self.assertIn("3. [todo] Next step", output)
                self.assertIn("1 done, 1 cancelled, 2 remaining", output)
                for hidden in ("Completed step", "Cancelled step", "Completion explanation", "Cancellation explanation", "Later step"):
                    self.assertNotIn(hidden, output)
                self.assertEqual(path.read_bytes(), before)

                conflict = self.call("list", "--next", "--remain", scope=scope)
                self.assert_explained_failure(conflict)
                self.assertEqual(path.read_bytes(), before)

                self.success("done", "--rational", "Next step verified", scope=scope)
                output = self.success("list", "--next", scope=scope)
                self.assertIn("4. [todo] Later step", output)
                self.assertNotIn("Next step", output)
                self.success("cancel", "--rational", "Later step no longer needed", scope=scope)
                output = self.success("list", "--next", scope=scope)
                self.assertIn("No remaining TODO items.", output)
                self.assertIn("2 done, 2 cancelled, 0 remaining", output)
                self.assertNotIn("Later step", output)

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
            self.assertEqual(len(list((home / ".battuta/todos").glob("todo-pm-*.jsonl"))), 1)
            self.assertIsNone(json.loads((home / ".battuta/projects/.config.json").read_text())["currentProject"])
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
        path = self.todo_path()
        before = path.read_bytes()
        for command in ("done", "cancel"):
            for options in ((), ("--rational", ""), ("--rational", " \n ")):
                with self.subTest(command=command, options=options):
                    result = self.call(command, *options)
                    self.assertNotEqual(result.exit_code, 0)
                    self.assertIn("rational", result.output)
                    self.assertEqual(path.read_bytes(), before)
