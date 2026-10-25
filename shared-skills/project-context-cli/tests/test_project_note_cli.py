"""Bot-facing notebooks: explicit boundaries and executable continuation."""

import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from click.testing import CliRunner

from battuta_project.cli import main
from battuta_project.notes import NoteStore


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
        self.runner = CliRunner()

    def invoke(self, *args, scope="general", role="pm"):
        with patch.dict(os.environ, {"AGENT_ROLE": role}):
            return self.runner.invoke(main, ["note", "--scope", scope, *args])

    def success(self, *args, **kwargs):
        result = self.invoke(*args, **kwargs)
        self.assertEqual(result.exit_code, 0, result.output)
        return result.output

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

    def test_note_commands_keep_existing_token_gate(self):
        with patch.dict(os.environ, {"LINEAR_API_TOKEN": ""}):
            for args in (("read",), ("append", "--text", "Finding"), ("search", "--query", "x")):
                self.assertNotEqual(self.invoke(*args).exit_code, 0)
        self.assertFalse((self.home / ".battuta").exists())
