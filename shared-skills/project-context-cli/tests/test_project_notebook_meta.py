"""Notebook index migration, validation and read-only discovery."""

import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import click

from battuta_project.notes import NoteStore
from battuta_project.todos import TodoStore


class NotebookMetaTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.home = Path(temporary.name)
        home = patch("pathlib.Path.home", return_value=self.home)
        home.start()
        self.addCleanup(home.stop)
        self.store = NoteStore("general", "pm")

    def test_absent_metadata_does_not_create_storage(self):
        self.assertIsNone(self.store.metadata())
        self.assertFalse((self.home / ".battuta").exists())

    def test_legacy_reads_are_read_only_and_first_mutation_upgrades(self):
        note = self.store.append("  Original **一**  ")
        metadata = note.path.with_suffix(".json")
        metadata.unlink(missing_ok=True)
        todo = TodoStore("general", "pm").create(["Independent"])
        state = self.store.work.registry.state_path.read_bytes()
        content = note.path.read_bytes()
        result, index = self.store.metadata()
        self.assertEqual(result.work_id, note.work_id)
        self.assertEqual(index["drafts"], [])
        self.assertEqual(index["itemFile"], note.path.name)
        self.assertEqual(len(self.store.read().lines), 1)
        self.assertFalse(metadata.exists())
        self.assertEqual(note.path.read_bytes(), content)
        self.store.append("Second")
        index = json.loads(metadata.read_text())
        self.assertEqual(index["workId"], note.work_id)
        self.assertEqual(index["nextDraftId"], 1)
        self.assertEqual(note.path.read_bytes(), content + b"Second\n")
        self.assertEqual(self.store.work.registry.state_path.read_bytes(), state)
        self.assertEqual(TodoStore("general", "pm").read().work_id, todo.work_id)
        self.assertEqual(metadata.stat().st_mode & 0o777, 0o600)

    def test_invalid_metadata_blocks_reads_and_writes_without_repair(self):
        note = self.store.append("Original")
        path = note.path.with_suffix(".json")
        valid = {"schemaVersion": 1, "scope": "general", "role": "pm", "project": None,
                 "workId": note.work_id, "itemFile": note.path.name, "nextDraftId": 1, "drafts": []}
        cases = ["broken", "[]", *[json.dumps({**valid, key: value}) for key, value in (
            ("schemaVersion", 2), ("schemaVersion", True), ("role", "tl"), ("scope", "project"),
            ("workId", "other"), ("itemFile", "../private"), ("nextDraftId", 0), ("drafts", {}))]]
        for data in cases:
            with self.subTest(data=data):
                path.write_text(data)
                for action in (self.store.metadata, self.store.read, lambda: self.store.append("New")):
                    with self.assertRaises(click.ClickException):
                        action()
                self.assertEqual(path.read_text(), data)
                self.assertEqual(note.path.read_text(), "Original\n")

    def test_unknown_fields_survive_mutations(self):
        note = self.store.append("Original")
        path = note.path.with_suffix(".json")
        index = json.loads(path.read_text())
        index["extra"] = {"preserve": True}
        path.write_text(json.dumps(index))
        self.store.append("Second")
        self.assertEqual(json.loads(path.read_text())["extra"], {"preserve": True})

    def test_missing_item_or_symlinked_metadata_is_not_an_empty_notebook(self):
        note = self.store.append("Original")
        note.path.unlink()
        with self.assertRaises(click.ClickException):
            self.store.metadata()
        note.path.write_text("Original\n")
        path = note.path.with_suffix(".json")
        private = self.home / "private"
        path.rename(private)
        path.symlink_to(private)
        with self.assertRaises(click.ClickException):
            self.store.metadata()

    def test_metadata_publication_failure_is_not_success(self):
        note = self.store.append("Original")
        path = note.path.with_suffix(".json")
        path.unlink()
        with patch("battuta_project.notebook_meta.atomic_write", side_effect=OSError("disk full")):
            with self.assertRaises(click.ClickException):
                self.store.append("Second")
        self.assertTrue(note.path.read_text().startswith("Original\n"))
        self.assertFalse(path.exists())

    def test_allocation_avoids_metadata_only_and_draft_only_orphans(self):
        directory = self.store.work.directory
        directory.mkdir(parents=True)
        (directory / "note-pm-aaaaa.json").write_text("preserve")
        (directory / "note-tl-bbbbb-draft-1.md").write_text("preserve")
        with patch("battuta_project.work.secrets.choice", side_effect=list("aaaaabbbbbccccc")):
            self.assertEqual(self.store.append("New").work_id, "ccccc")
