"""Ordered next-item and remaining-queue persistence contracts."""

from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from battuta_project.todo_errors import TodoError, TodoErrorCode
from battuta_project.todos import TodoStore


def advance_in_process(home):
    with patch("pathlib.Path.home", return_value=Path(home)):
        TodoStore("general", "pm").advance("done", rational="Verified the step's outcome")


class TodoTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        home = patch("pathlib.Path.home", return_value=self.home)
        home.start()
        self.addCleanup(home.stop)
        self.store = TodoStore("general", "pm")

    def create(self, *items, second=0, force=False):
        with patch("battuta_project.todos.datetime", wraps=datetime) as clock:
            clock.now.return_value = datetime(2026, 10, 23, 12, 0, second, tzinfo=timezone.utc)
            return self.store.create(list(items), force=force)

    def test_error_explanations_render_without_relying_on_exact_wording(self):
        for code in TodoErrorCode:
            with self.subTest(code=code):
                error = TodoError(code, filename="active.jsonl", remaining="1. Review requirements", path="active.jsonl", detail="Example cause")
                self.assertGreater(len(str(error).partition(": ")[2].strip()), 50)

    def test_advance_changes_only_next_item(self):
        for status in ("done", "cancelled"):
            with self.subTest(status=status):
                created = self.create("First", "Next", "Last", second=int(status == "cancelled"), force=True)
                self.store.advance("done", rational="Verified first step")
                result = self.store.advance(status, rational="Next step explanation")
                self.assertEqual([item.model_dump() for item in result.items], [
                    {"id": 1, "status": "done", "description": "First", "rational": "Verified first step"},
                    {"id": 2, "status": status, "description": "Next", "rational": "Next step explanation"},
                    {"id": 3, "status": "todo", "description": "Last", "rational": ""},
                ])
                self.store.advance("cancelled", rational="Owner no longer needs the last step")
                before = created.path.read_bytes()
                with self.assertRaisesRegex(TodoError, "NO_NEXT_TODO"):
                    self.store.advance(status, rational="No item to explain")
                self.assertEqual(created.path.read_bytes(), before)

    def test_update_replaces_only_remaining_items(self):
        self.create("Complete", "Abandon", "Old next", "Old last")
        self.store.advance("done", rational="Verified first step")
        self.store.advance("cancelled", rational="Owner dropped legacy support")
        result = self.store.update_todo(["New next", "New last", "Extra"])
        self.assertEqual([item.model_dump() for item in result.items], [
            {"id": 1, "status": "done", "description": "Complete", "rational": "Verified first step"},
            {"id": 2, "status": "cancelled", "description": "Abandon", "rational": "Owner dropped legacy support"},
            {"id": 3, "status": "todo", "description": "New next", "rational": ""},
            {"id": 4, "status": "todo", "description": "New last", "rational": ""},
            {"id": 5, "status": "todo", "description": "Extra", "rational": ""},
        ])

    def test_advancement_requires_rational_without_mutating_on_invalid_input(self):
        created = self.create("Next")
        before = created.path.read_bytes()
        for status in ("done", "cancelled"):
            for rational in ("", " \n ", None):
                with self.subTest(status=status, rational=rational):
                    with self.assertRaisesRegex(TodoError, "INVALID_INPUT"):
                        self.store.advance(status, rational=rational)
                    self.assertEqual(created.path.read_bytes(), before)

    def test_descriptions_round_trip_unicode_line_separators(self):
        descriptions = [f"First{separator}Second" for separator in ("\u2028", "\u2029", "\u0085", "\n")]
        self.create(*descriptions)
        self.assertEqual([item.description for item in self.store.read().items], descriptions)
        for index, description in enumerate(descriptions):
            with self.subTest(description=repr(description)):
                self.assertEqual(self.store.advance("done", rational="Verified Unicode text").items[index].description, description)

    def test_creation_guard_force_and_collision_preserve_history(self):
        first = self.create("Unfinished")
        before = first.path.read_bytes()
        with self.assertRaisesRegex(TodoError, "UNFINISHED_TODO"):
            self.create("New", second=1)
        second = self.create("New", second=1, force=True)
        self.assertEqual(first.path.read_bytes(), before)
        self.assertEqual(self.store.read().path, second.path)
        # File timestamps, not mtime, determine which list is active.
        first.path.touch()
        self.assertEqual(self.store.read().path, second.path)
        with self.assertRaisesRegex(TodoError, "TIMESTAMP_COLLISION"):
            self.create("Collision", second=1, force=True)
        self.assertEqual(self.store.read().items[0].description, "New")

    def test_invalid_data_never_changes_or_falls_back(self):
        first = self.create("Original")
        for items in ([], [" "], [42]):
            with self.subTest(items=items), self.assertRaisesRegex(TodoError, "INVALID_INPUT"):
                self.store.update_todo(items)
        invalid_records = [
            {"id": True, "status": "todo", "description": "Bad ID"},
            {"id": 2, "status": "todo", "description": "Skipped ID"},
            {"id": 1, "status": "pending", "description": "Bad status"},
            {"id": 1, "status": "todo", "description": " "},
            {"id": 1, "status": "todo", "description": "Extra", "role": "pm"},
        ]
        invalid_records += [
            {"id": 1, "status": "done", "description": "Missing explanation", "rational": ""},
            {"id": 1, "status": "cancelled", "description": "Blank explanation", "rational": " "},
            {"id": 1, "status": "todo", "description": "Premature explanation", "rational": "Already verified"},
        ]
        invalid_texts = [json.dumps({"rational": "", **item}) + "\n" for item in invalid_records]
        invalid_texts += ["{broken", '\n', json.dumps({"id": 1, "status": "todo", "description": "First", "rational": ""}) + '\n' + json.dumps({"id": 2, "status": "done", "description": "Out of order", "rational": "Verified"}) + '\n', ""]
        for text in invalid_texts:
            with self.subTest(text=text):
                first.path.write_text(text)
                with self.assertRaisesRegex(TodoError, "INVALID_TODO_FILE"):
                    self.create("Must not bypass corruption", second=2, force=True)
                self.assertEqual(first.path.read_text(), text)

    def test_absent_reads_and_failed_writes_do_not_change_lists(self):
        self.assertIsNone(self.store.read())
        self.assertFalse((self.home / ".battuta").exists())
        with self.assertRaisesRegex(TodoError, "NO_TODO_LIST"):
            self.store.advance("done", rational="Verified step")
        created = self.create("Original")
        before = created.path.read_bytes()
        with patch("battuta_project.storage.os.replace", side_effect=OSError("disk failure")):
            with self.assertRaisesRegex(TodoError, "TODO_STORAGE_ERROR"):
                self.store.advance("done", rational="Verified step")
        self.assertEqual(created.path.read_bytes(), before)

    def test_symlinks_are_rejected_without_changing_targets(self):
        created = self.create("Original")
        target = self.home / "private.jsonl"
        created.path.rename(target)
        created.path.symlink_to(target)
        before = target.read_bytes()
        with self.assertRaisesRegex(TodoError, "TODO_STORAGE_ERROR"):
            self.store.advance("done", rational="Verified step")
        self.assertEqual(target.read_bytes(), before)

    def test_parallel_advances_do_not_lose_progress(self):
        self.create("First", "Second", "Last")
        with ProcessPoolExecutor(max_workers=2) as pool:
            list(pool.map(advance_in_process, [str(self.home)] * 2))
        self.assertEqual([item.status for item in self.store.read().items], ["done", "done", "todo"])
