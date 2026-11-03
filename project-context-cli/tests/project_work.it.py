"""Real installed CLI, filesystem and ripgrep integration across fresh processes."""

import os
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest


class ProjectWorkTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.home = Path(temp.name)
        self.command = Path(sys.executable).with_name("battuta-project")
        self.env = {**os.environ, "HOME": str(self.home), "LINEAR_API_TOKEN": "test-token", "AGENT_ROLE": "pm"}

    def cli(self, *args, role="pm", content=None):
        result = subprocess.run([str(self.command), *args], env={**self.env, "AGENT_ROLE": role},
                                cwd=self.home, capture_output=True, text=True, input=content, timeout=15)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result.stdout

    def work_id(self, output):
        match = re.search(r"^Work: (?:pm|tl):([a-z0-9]{5})$", output, re.MULTILINE)
        self.assertIsNotNone(match, output)
        return match[1]

    def test_notes_first_leave_todo_management_independent(self):
        self.assert_independent(notes_first=True)

    def test_todos_first_leave_notebook_management_independent(self):
        self.assert_independent(notes_first=False)

    def assert_independent(self, *, notes_first):
        self.cli("init", "atlas")
        for scope in ("general", "project"):
            for role in ("pm", "tl"):
                with self.subTest(scope=scope, role=role):
                    def call(kind, *args):
                        return self.cli(kind, "--scope", scope, *args, role=role)

                    directory = self.home / ".battuta" / ("projects/atlas/work" if scope == "project" else "work")
                    if notes_first:
                        note_id = self.work_id(call("note", "append", "--text", f"Finding {scope}/{role}"))
                        self.assertIn("No active TODO list", call("todo", "list"))
                        self.assertFalse(list(directory.glob(f"todo-{role}-*.jsonl")))
                    else:
                        self.assertIn("No notebook", call("note", "read"))
                    todo_id = self.work_id(call("todo", "create", "--item", "First", "--item", "Second"))
                    if not notes_first:
                        self.assertIn("No notebook", call("note", "read"))
                        self.assertFalse(list(directory.glob(f"note-{role}-*.md")))
                        note_id = self.work_id(call("note", "append", "--text", f"Finding {scope}/{role}"))
                    self.assertNotEqual(todo_id, note_id)
                    notebook = directory / f"note-{role}-{note_id}.md"
                    original_note = notebook.read_bytes()

                    call("todo", "extend", "--item", "Third")
                    call("todo", "done", "--rational", "Verified first")
                    call("todo", "cancel", "--rational", "Second no longer needed")
                    call("todo", "done", "--rational", "Verified third")
                    next_todo_id = self.work_id(call("todo", "create", "--item", "New work"))
                    self.assertNotEqual(next_todo_id, todo_id)
                    self.assertEqual(notebook.read_bytes(), original_note)
                    note_output = call("note", "read")
                    self.assertEqual(self.work_id(note_output), note_id)
                    self.assertIn(f"Scope: {scope}", note_output)
                    self.assertIn(f"Role: {role}", note_output)
                    self.assertIn("File:", note_output)

                    before = {path.name: path.read_bytes() for path in directory.glob("todo-*.jsonl")}
                    todo_output = call("todo", "list")
                    self.assertEqual(self.work_id(call("note", "append", "--text", "Thought two")), note_id)
                    output = call("note", "read", "--from-line", "2", "--to-line", "2")
                    self.assertIn("2. Thought two", output)
                    self.assertNotIn("1. Finding", output)
                    self.assertEqual(call("todo", "list"), todo_output)
                    self.assertEqual({path.name: path.read_bytes() for path in directory.glob("todo-*.jsonl")}, before)

    def test_roles_scopes_and_projects_do_not_mix(self):
        self.cli("init", "atlas")
        for scope in ("general", "project"):
            for role in ("pm", "tl"):
                marker = f"{scope}/{role}"
                self.cli("note", "--scope", scope, "append", "--text", marker, role=role)
                self.cli("todo", "--scope", scope, "create", "--item", marker, role=role)
        for scope in ("general", "project"):
            for role in ("pm", "tl"):
                for kind, action in (("note", "read"), ("todo", "list")):
                    with self.subTest(scope=scope, role=role, kind=kind):
                        output = self.cli(kind, "--scope", scope, action, role=role)
                        self.assertIn(f"{scope}/{role}", output)
                        for other in ({"general/pm", "general/tl", "project/pm", "project/tl"} - {f"{scope}/{role}"}):
                            self.assertNotIn(other, output)
        self.cli("init", "beacon")
        for role in ("pm", "tl"):
            self.assertIn("No notebook", self.cli("note", "--scope", "project", "read", role=role))
            self.assertIn("No active TODO list", self.cli("todo", "--scope", "project", "list", role=role))
        self.cli("switch", "atlas")
        self.assertIn("project/pm", self.cli("note", "--scope", "project", "read"))

    def test_general_work_requires_no_project(self):
        self.cli("note", "--scope", "general", "append", "--text", "Learning")
        self.cli("todo", "--scope", "general", "create", "--item", "Task")
        self.assertIn("1. Learning", self.cli("note", "--scope", "general", "read"))
        self.assertIn("1. [todo] Task", self.cli("todo", "--scope", "general", "list"))

    def test_draft_pipeline_edits_and_missing_files_across_roles_and_scopes(self):
        self.cli("init", "atlas")
        for scope in ("general", "project"):
            for role in ("pm", "tl"):
                with self.subTest(scope=scope, role=role):
                    body = f"# {scope}/{role}\n\nComplete document without final newline"
                    created = self.cli("note", "--scope", scope, "draft", "--title", "Research", role=role, content=body)
                    path = Path(created.splitlines()[0].split(" saved to ", 1)[1])
                    self.assertEqual(path.read_text(), body)
                    self.assertTrue(created.endswith("\n\n" + body))
                    self.assertEqual(self.cli("note", "--scope", scope, "draft", "--get", "1", role=role), body)
                    self.assertIn("Items: 0", self.cli("note", "--scope", scope, "--meta", role=role))
                    path.write_text(body + "\nEdited\n")
                    self.assertEqual(self.cli("note", "--scope", scope, "draft", "--get", "1", role=role), body + "\nEdited\n")
                    path.unlink()
                    self.assertIn("missing", self.cli("note", "--scope", scope, "draft", "--list", role=role))
                    result = subprocess.run([str(self.command), "note", "--scope", scope, "draft", "--get", "1"],
                                            env={**self.env, "AGENT_ROLE": role}, capture_output=True, text=True, timeout=15)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertEqual(result.stdout, "")
                    self.assertIn("reference has been retained", result.stderr)

    def test_parallel_draft_creation_and_legacy_upgrade_share_one_notebook(self):
        first = self.cli("note", "--scope", "general", "append", "--text", "Legacy")
        identifier = self.work_id(first)
        directory = self.home / ".battuta/work"
        metadata = directory / f"note-pm-{identifier}.json"
        metadata.unlink()
        self.cli("todo", "--scope", "general", "create", "--item", "Keep")
        todo = self.cli("todo", "--scope", "general", "list")
        def create(number):
            return self.cli("note", "--scope", "general", "draft", "--title", f"Draft {number}", content=f"Body {number}")
        with ThreadPoolExecutor(max_workers=4) as pool:
            outputs = list(pool.map(create, range(8)))
        self.assertEqual(len(set(output.splitlines()[0].split(" saved to ")[0] for output in outputs)), 8)
        index = json.loads(metadata.read_text())
        self.assertEqual(index["workId"], identifier)
        self.assertEqual([draft["id"] for draft in index["drafts"]], list(range(1, 9)))
        self.assertEqual((directory / index["itemFile"]).read_text(), "Legacy\n")
        self.assertEqual(self.cli("todo", "--scope", "general", "list"), todo)
        self.assertIn("1. Legacy", self.cli("note", "--scope", "general", "item", "--search", "legacy"))

    def test_numbered_search_and_read_continuations_preserve_text(self):
        self.assertIsNotNone(shutil.which("rg"), "Install ripgrep to run notebook integration tests")
        texts = ["\ufeffFinding café", "Needle.*", "other", "NEEDLE.* two", "-n $(touch nope) ; café", "needle.* three"]
        for text in texts:
            self.cli("note", "--scope", "general", "append", "--text", text)
        config = self.home / "rg-config"
        config.write_text("--files\n--glob=*.private\n")
        self.env["RIPGREP_CONFIG_PATH"] = str(config)
        for query in ("Finding", "\ufeffFinding"):
            self.assertIn("1. \ufeffFinding café", self.cli("note", "--scope", "general", "search", "--query", query))
        self.assertIn("5. -n $(touch nope) ; café", self.cli("note", "--scope", "general", "search", "--query", "-n $(touch nope) ; CAFÉ"))
        self.assertFalse((self.home / "nope").exists())
        self.assertIn("No matches", self.cli("note", "--scope", "general", "search", "--query", "absent"))
        for args, expected_first, expected_next, excluded in (
            (("search", "--query", "needle.*", "--limit", "1"), "2. Needle.*", "4. NEEDLE.* two", "3. other"),
            (("read", "--from-line", "2", "--to-line", "3", "--limit", "1"), "2. Needle.*", "3. other", "4. NEEDLE.* two"),
            (("item", "--search", "needle.*", "--limit", "1"), "2. Needle.*", "4. NEEDLE.* two", "3. other"),
            (("item", "--list", "--from-line", "2", "--to-line", "3", "--limit", "1"), "2. Needle.*", "3. other", "4. NEEDLE.* two"),
        ):
            with self.subTest(args=args):
                output = self.cli("note", "--scope", "general", *args)
                self.assertIn(expected_first, output)
                self.assertIn("Truncated", output)
                continuation = next(shlex.split(line) for line in output.splitlines() if line.startswith("battuta-project "))
                resumed = self.cli(*continuation[1:])
                self.assertIn(expected_next, resumed)
                self.assertNotIn(expected_first, resumed)
                self.assertNotIn(excluded, resumed)
        matches = self.cli("note", "--scope", "general", "search", "--query", "needle.*")
        for line in ("2. Needle.*", "4. NEEDLE.* two", "6. needle.* three"):
            self.assertIn(line, matches)
        self.assertNotIn("3. other", matches)
        full = self.cli("note", "--scope", "general", "read")
        for number, text in enumerate(texts, 1):
            self.assertIn(f"{number}. {text}", full)


if __name__ == "__main__":
    unittest.main(verbosity=2)
