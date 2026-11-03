"""Draft stdin creation, full output and noninteractive error contracts."""

import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import click
from click.testing import CliRunner

from battuta_project.cli import main


class DraftCliTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.home = Path(temporary.name)
        home = patch("pathlib.Path.home", return_value=self.home)
        home.start()
        self.addCleanup(home.stop)
        env = patch.dict(os.environ, {"LINEAR_API_TOKEN": "test", "AGENT_ROLE": "pm"})
        env.start()
        self.addCleanup(env.stop)

    def invoke(self, *args, content=None):
        return CliRunner().invoke(main, ["note", "--scope", "general", "draft", *args], input=content)

    def test_create_reports_absolute_path_and_complete_body_then_get_reflects_edits(self):
        body = "# 一\n\n" + "x" * 20000
        result = self.invoke("--title", "Research", content=body)
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertTrue(result.output.startswith("Draft 1 saved to /"))
        self.assertEqual(result.output.split("\n\n", 1)[1], body)
        path = Path(result.output.splitlines()[0].split(" saved to ", 1)[1])
        self.assertEqual(path.read_text(), body)
        self.assertEqual(self.invoke("--get", "1").output, body)
        path.write_text("Edited\n")
        self.assertEqual(self.invoke("--get", "1").output, "Edited\n")
        listed = self.invoke("--list")
        self.assertEqual(listed.exit_code, 0, listed.output)
        self.assertIn("Research", listed.output)
        self.assertNotIn("Edited", listed.output)

    def test_invalid_modes_and_encoding_fail_without_content_creation(self):
        for args, content in ((("--title", "Title"), b"\xff"), (("--title", "Title"), ""),
                              (("--title", "Title", "--list"), "Body"), (("--get", "0"), None),
                              (("--get", "1", "--title", "Other"), "Body"), ((), None)):
            with self.subTest(args=args, content=content):
                self.assertNotEqual(self.invoke(*args, content=content).exit_code, 0)
        self.assertFalse(list(self.home.rglob("*-draft-*.md")))

    def test_terminal_creation_fails_instead_of_waiting_for_input(self):
        with CliRunner().isolation(), patch("battuta_project.note_cli.sys.stdin.isatty", return_value=True):
            with self.assertRaisesRegex(click.UsageError, "stdin"):
                main.main(["note", "--scope", "general", "draft", "--title", "Title"], standalone_mode=False)
