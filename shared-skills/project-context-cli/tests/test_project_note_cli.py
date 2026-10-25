"""Bot-facing notebooks: explicit boundaries and executable continuation."""

import os
from pathlib import Path
import shlex
import shutil
import tempfile
import unittest
from unittest.mock import patch

from click.testing import CliRunner

from battuta_project.cli import main
from battuta_project.notes import NoteStore
from battuta_project.registry import ProjectRegistry


class NoteCliTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.home = Path(temp.name)
        home = patch("pathlib.Path.home", return_value=self.home)
        home.start()
        self.addCleanup(home.stop)
        env = patch.dict(os.environ, {"LINEAR_API_TOKEN": "test-token"})
        env.start()
        self.addCleanup(env.stop)
        self.registry = ProjectRegistry()
        self.runner = CliRunner()

    def invoke(self, *args, scope="general", role="pm"):
        with patch.dict(os.environ, {"AGENT_ROLE": role}):
            return self.runner.invoke(main, ["note", "--scope", scope, *args])

    def success(self, *args, **kwargs):
        result = self.invoke(*args, **kwargs)
        self.assertEqual(result.exit_code, 0, result.output)
        return result.output

    def test_both_roles_and_scopes_append_and_read_without_todos(self):
        self.registry.init("atlas")
        for scope in ("project", "general"):
            for role in ("pm", "tl"):
                with self.subTest(scope=scope, role=role):
                    output = self.success("append", "--text", f"Finding {scope}/{role}", scope=scope, role=role)
                    self.assertIn(f"Scope: {scope}", output)
                    self.assertIn(f"Role: {role}", output)
                    self.assertIn(f"Work: {role}:", output)
                    self.assertIn("File:", output)
                    self.assertIn(f"1. Finding {scope}/{role}", output)
                    self.assertIn(f"1. Finding {scope}/{role}", self.success("read", scope=scope, role=role))
        self.assertNotEqual(self.registry.current_note_work_id(None, "pm"), self.registry.current_note_work_id("atlas", "pm"))

    def test_missing_empty_range_and_invalid_invocations(self):
        self.assertIn("No notebook", self.success("read"))
        self.success("append", "--text", "first")
        note = NoteStore("general", "pm").read()
        before = note.path.read_bytes()
        for args in (("append", "--text", " "), ("read", "--from-line", "0"),
                     ("read", "--from-line", "3", "--to-line", "2"), ("read", "--limit", "0")):
            with self.subTest(args=args):
                self.assertNotEqual(self.invoke(*args).exit_code, 0)
                self.assertEqual(note.path.read_bytes(), before)
        self.assertNotEqual(self.invoke("read", role="").exit_code, 0)
        self.assertNotEqual(self.invoke("read", scope="project").exit_code, 0)
        self.assertNotEqual(self.runner.invoke(main, ["note", "read"]).exit_code, 0)
        self.assertIn("No notes", self.success("read", "--from-line", "99"))
        note.path.write_bytes(b"")
        self.assertIn("No notes", self.success("read"))

    @unittest.skipUnless(shutil.which("rg"), "ripgrep required")
    def test_read_search_and_continuation_commands_preserve_boundaries(self):
        for text in ("match first", "other", "match second", "match third"):
            self.success("append", "--text", text)
        output = self.success("read", "--from-line", "2", "--to-line", "3")
        self.assertIn("2. other", output)
        self.assertIn("3. match second", output)
        self.assertNotIn("1. match first", output)
        for args in (("read", "--to-line", "3", "--limit", "1"),
                     ("search", "--query", "MATCH", "--limit", "1")):
            output = self.success(*args)
            self.assertIn("1. match first", output)
            self.assertIn("Truncated", output)
            example = next(shlex.split(line) for line in output.splitlines() if line.startswith("battuta-project "))
            with patch.dict(os.environ, {"AGENT_ROLE": "pm"}):
                resumed = self.runner.invoke(main, example[1:])
            self.assertEqual(resumed.exit_code, 0, resumed.output)
            self.assertNotIn("1. match first", resumed.output)
            if args[0] == "read":
                self.assertIn("2. other", resumed.output)
                self.assertNotIn("4. match third", resumed.output)
            else:
                self.assertIn("3. match second", resumed.output)
        self.assertIn("No matches", self.success("search", "--query", "absent"))

    def test_note_commands_keep_existing_token_gate(self):
        with patch.dict(os.environ, {"LINEAR_API_TOKEN": ""}):
            for args in (("read",), ("append", "--text", "Finding"), ("search", "--query", "x")):
                self.assertNotEqual(self.invoke(*args).exit_code, 0)
        self.assertFalse((self.home / ".battuta").exists())
