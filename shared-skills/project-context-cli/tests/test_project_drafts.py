"""Draft registration and retrieval leave editing to ordinary file tools."""

import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import click

from battuta_project.notes import NoteStore


class DraftTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.home = Path(temporary.name)
        home = patch("pathlib.Path.home", return_value=self.home)
        home.start()
        self.addCleanup(home.stop)
        self.notes = NoteStore("general", "pm")

    def drafts(self, role="pm"):
        from battuta_project.drafts import DraftStore
        return DraftStore(NoteStore("general", role))

    def test_creation_retrieval_and_external_edit_preserve_identity(self):
        drafts = self.drafts()
        body = "# Findings 一\n\nFirst paragraph.\nSecond paragraph."
        notebook, draft = drafts.create("Research", body)
        path = notebook.path.parent / draft["file"]
        self.assertEqual(draft["id"], 1)
        self.assertEqual(path.read_bytes(), body.encode())
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(notebook.path.read_bytes(), b"")
        self.assertEqual(drafts.get(1), body)
        path.write_text("Edited\n")
        self.assertEqual(self.drafts().get(1), "Edited\n")
        self.assertEqual(self.drafts().listing()[1][0]["id"], 1)
        self.notes.append("Separate item")
        self.assertEqual(self.notes.read().lines[0].text, "Separate item")
        self.assertEqual(drafts.create("Research", "Second")[1]["id"], 2)
        self.assertEqual(self.drafts("tl").create("Research", "TL")[1]["id"], 1)

    def test_absent_discovery_and_invalid_inputs_do_not_create_storage(self):
        drafts = self.drafts()
        self.assertIsNone(drafts.listing())
        for title, text in (("", "Body"), (" ", "Body"), ("A\nB", "Body"),
                            ("A", ""), ("A", " \n"), ("A", "x\x00y"), ("A", "\ud800")):
            with self.subTest(title=title, text=repr(text)), self.assertRaises(click.ClickException):
                drafts.create(title, text)
        for identifier in (0, 1, -1):
            with self.assertRaises(click.ClickException):
                drafts.get(identifier)
        self.assertFalse((self.home / ".battuta").exists())

    def test_missing_registered_file_is_reported_and_not_replaced(self):
        drafts = self.drafts()
        notebook, draft = drafts.create("Research", "Body")
        path = notebook.path.parent / draft["file"]
        path.unlink()
        self.assertEqual(drafts.listing()[1][0]["availability"], "missing")
        with self.assertRaisesRegex(click.ClickException, "registered.*missing"):
            drafts.get(1)
        with self.assertRaisesRegex(click.ClickException, "Unknown draft"):
            drafts.get(2)
        self.assertEqual(drafts.create("Next", "New")[1]["id"], 2)
        self.assertFalse(path.exists())
        self.assertEqual(len(drafts.listing()[1]), 2)

    def test_failed_registration_retains_saved_file_and_retry_skips_it(self):
        drafts = self.drafts()
        notebook, first = drafts.create("First", "Original")
        metadata = notebook.path.with_suffix(".json")
        before = metadata.read_bytes()
        with patch("battuta_project.drafts.notebook_meta.save", side_effect=OSError("disk full")):
            with self.assertRaisesRegex(click.ClickException, "unregistered.*draft-2.md"):
                drafts.create("Second", "Retained")
        orphan = notebook.path.parent / f"{notebook.path.stem}-draft-2.md"
        self.assertEqual(orphan.read_text(), "Retained")
        self.assertEqual(metadata.read_bytes(), before)
        self.assertEqual(drafts.create("Retry", "Retry")[1]["id"], 3)
        self.assertEqual([row["id"] for row in drafts.listing()[1]], [1, 3])
        self.assertEqual(drafts.get(1), "Original")

    def test_unsafe_files_paths_and_invalid_content_fail_without_leakage(self):
        drafts = self.drafts()
        notebook, draft = drafts.create("Research", "Body")
        path = notebook.path.parent / draft["file"]
        private = self.home / "private"
        private.write_text("Private")
        path.unlink()
        path.symlink_to(private)
        for action in (drafts.listing, lambda: drafts.get(1)):
            with self.assertRaises(click.ClickException):
                action()
        path.unlink()
        path.mkdir()
        with self.assertRaises(click.ClickException):
            drafts.get(1)
        path.rmdir()
        for content in (b"invalid\xff", b"bad\x00text"):
            path.write_bytes(content)
            with self.assertRaises(click.ClickException):
                drafts.get(1)
        path.write_text("Body")
        with patch("battuta_project.drafts.read_text", side_effect=PermissionError("denied")):
            with self.assertRaisesRegex(click.ClickException, "denied"):
                drafts.get(1)
        metadata = notebook.path.with_suffix(".json")
        index = json.loads(metadata.read_text())
        index["drafts"][0]["file"] = "../private"
        metadata.write_text(json.dumps(index))
        with self.assertRaises(click.ClickException):
            drafts.get(1)
        self.assertEqual(private.read_text(), "Private")
