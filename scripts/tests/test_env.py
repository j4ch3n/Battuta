"""Environment-file syntax supported by bot configuration commands."""

from pathlib import Path
import sys
import tempfile
import unittest

import click

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bot_setup.env import read_env  # noqa: E402


class EnvironmentTests(unittest.TestCase):
    def test_assignment_quotes_exports_and_comment_handling(self):
        cases = (
            ("TOKEN=abc # rotated", "abc"),
            ('TOKEN="abc # literal" # comment', "abc # literal"),
            ("TOKEN='abc#literal'", "abc#literal"),
            ("TOKEN=abc#literal", "abc#literal"),
            ("export TOKEN='abc def'", "abc def"),
            ("TOKEN= # unset", ""),
        )
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            for assignment, expected in cases:
                with self.subTest(assignment=assignment):
                    path.write_text("# heading\n\n" + assignment + "\n")
                    self.assertEqual(read_env(path), {"TOKEN": expected})

    def test_invalid_quoting_reports_file_without_echoing_secret(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            path.write_text('TOKEN="private-token\n')
            with self.assertRaises(click.ClickException) as caught:
                read_env(path)
            self.assertIn(str(path), str(caught.exception))
            self.assertNotIn("private-token", str(caught.exception))
