"""Independent notebook persistence, safety and concurrency contracts."""

from concurrent.futures import ProcessPoolExecutor
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import click

from battuta_project.notes import NoteStore
from battuta_project.registry import ProjectRegistry
from battuta_project.todos import TodoStore


def append_in_process(args):
    home, text = args
    with patch("pathlib.Path.home", return_value=Path(home)):
        return NoteStore("general", "pm").append(text).work_id


def todo_in_process(home):
    with patch("pathlib.Path.home", return_value=Path(home)):
        return TodoStore("general", "pm").create(["Independent task"]).work_id


class NoteTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        home = patch("pathlib.Path.home", return_value=self.home)
        home.start()
        self.addCleanup(home.stop)
        self.store = NoteStore("general", "pm")

    def test_absent_reads_do_not_initialize_storage(self):
        self.assertIsNone(self.store.read())
        self.assertIsNone(self.store.search("unknown"))
        self.assertFalse((self.home / ".battuta").exists())

    @unittest.skipUnless(shutil.which("rg"), "ripgrep is required for real search verification")
    def test_real_search_is_literal_case_insensitive_numbered_and_resumable(self):
        texts = ["Needle.*", "other", "NEEDLE.* two", "-n $(touch nope) ; café", "needle.* three"]
        for text in texts:
            self.store.append(text)
        config = self.home / "rg-config"
        config.write_text("--files\n--glob=*.private\n")
        with patch.dict(os.environ, {"RIPGREP_CONFIG_PATH": str(config)}):
            result = self.store.search("needle.*", limit=1)
        self.assertEqual([(line.number, line.text) for line in result.lines], [(1, "Needle.*")])
        self.assertEqual(result.next_line, 3)
        result = self.store.search("needle.*", from_line=result.next_line)
        self.assertEqual([line.number for line in result.lines], [3, 5])
        self.assertIsNone(result.next_line)
        self.assertEqual([line.number for line in self.store.search("-n $(touch nope) ; CAFÉ").lines], [4])
        self.assertEqual(self.store.search("absent").lines, [])
        self.assertFalse((self.home / "nope").exists())

    def test_search_errors_and_untrusted_queries(self):
        note = self.store.append("-n literal")
        match = json.dumps({"type": "match", "data": {"line_number": 1, "lines": {"text": "-n literal\n"}}})
        with patch("battuta_project.notes.subprocess.run", return_value=subprocess.CompletedProcess([], 0, match, "")) as run:
            result = self.store.search("-n")
        self.assertEqual([line.text for line in result.lines], ["-n literal"])
        self.assertEqual(run.call_args.args[0], ["rg", "--no-config", "--json", "--fixed-strings", "--ignore-case", "--text", "-e", "-n", "--", str(note.path)])
        self.assertFalse(run.call_args.kwargs.get("shell", False))
        for code, output in ((1, ""), (0, match)):
            with patch("battuta_project.notes.subprocess.run", return_value=subprocess.CompletedProcess([], code, output, "")):
                self.assertEqual(len(self.store.search("query").lines), 0 if code == 1 else 1)
        for response in (subprocess.CompletedProcess([], 2, "", "bad"),
                         subprocess.CompletedProcess([], 0, "not json", ""),
                         subprocess.CompletedProcess([], 0, '{"type":"match","data":{}}', "")):
            with self.subTest(response=response), patch("battuta_project.notes.subprocess.run", return_value=response):
                with self.assertRaises(click.ClickException):
                    self.store.search("query")
        with patch("battuta_project.notes.subprocess.run", side_effect=FileNotFoundError("rg")):
            with self.assertRaisesRegex(click.ClickException, "ripgrep"):
                self.store.search("query")
        for query in (" ", "x\ny", "x\x00y"):
            with self.subTest(query=query), self.assertRaises(click.ClickException):
                self.store.search(query)
        for options in ({"from_line": 0}, {"limit": 0}):
            with self.assertRaises(click.ClickException):
                self.store.search("query", **options)

    def test_append_preserves_text_and_survives_restart_without_todos(self):
        first = self.store.append("  Finding **一**  ")
        self.assertEqual(first.path, self.home / ".battuta/work" / f"note-pm-{first.work_id}.md")
        self.assertEqual(first.path.stat().st_mode & 0o777, 0o600)
        state = self.store.work.registry.state_path.read_bytes()
        result = self.store.append("Thought two")
        self.assertEqual([(line.number, line.text) for line in result.lines], [(2, "Thought two")])
        self.assertEqual(first.path.read_bytes(), "  Finding **一**  \nThought two\n".encode())
        self.assertEqual(self.store.work.registry.state_path.read_bytes(), state)
        read = NoteStore("general", "pm").read()
        self.assertEqual([line.text for line in read.lines], ["  Finding **一**  ", "Thought two"])
        self.assertEqual(read.work_id, first.work_id)
        self.assertIsNone(TodoStore("general", "pm").read())
        self.assertFalse(list(first.path.parent.glob("todo-*.jsonl")))

    def test_ranges_and_continuation_preserve_complete_notes(self):
        for text in ("first", "x" * 20000, "third", "last"):
            self.store.append(text)
        cases = [({}, [1, 2, 3, 4], None), ({"from_line": 2, "to_line": 3}, [2, 3], None),
                 ({"limit": 2}, [1, 2], 3), ({"from_line": 3, "limit": 2}, [3, 4], None),
                 ({"from_line": 2, "to_line": 3, "limit": 1}, [2], 3),
                 ({"from_line": 4, "to_line": 99}, [4], None), ({"from_line": 9}, [], None)]
        for options, numbers, continuation in cases:
            with self.subTest(options=options):
                result = self.store.read(**options)
                self.assertEqual([line.number for line in result.lines], numbers)
                self.assertEqual(result.next_line, continuation)
                if 2 in numbers:
                    self.assertEqual(result.lines[numbers.index(2)].text, "x" * 20000)
        for options in ({"from_line": 0}, {"to_line": 0}, {"from_line": 3, "to_line": 2}, {"limit": 0}):
            with self.subTest(options=options), self.assertRaises(click.ClickException):
                self.store.read(**options)

    def test_invalid_notes_leave_state_and_storage_unchanged(self):
        for text in ("", "  ", "a\nb", "a\rb", "a\x00b", "a\x85b", "a\u2028b", "a\u2029b", "a\vb", "a\fb", "a\x1cb", "a\ud800"):
            with self.subTest(text=repr(text)), self.assertRaises(click.ClickException):
                self.store.append(text)
        self.assertFalse((self.home / ".battuta").exists())

    def test_scopes_roles_and_todo_rotation_are_independent(self):
        registry = ProjectRegistry()
        registry.init("atlas")
        for scope in ("general", "project"):
            for role in ("pm", "tl"):
                with self.subTest(scope=scope, role=role):
                    todos = TodoStore(scope, role)
                    if role == "tl":
                        todo = todos.create(["Task first"])
                    notes = NoteStore(scope, role)
                    note = notes.append(f"{scope}/{role}")
                    if role == "pm":
                        todo = todos.create(["Task second"])
                    self.assertNotEqual(note.work_id, todo.work_id)
                    todos.create(["Rotated"], force=True)
                    self.assertEqual(notes.read().work_id, note.work_id)
                    self.assertEqual([line.text for line in notes.read().lines], [f"{scope}/{role}"])
        registry.init("other")
        self.assertIsNone(NoteStore("project", "pm").read())

    def test_empty_missing_and_malformed_published_files(self):
        note = self.store.append("Original")
        for data in (b"partial", b"invalid\xff\n", b"a\rb\n", b"a\x00b\n"):
            note.path.write_bytes(data)
            for action in (self.store.read, lambda: self.store.append("new")):
                with self.subTest(data=data), self.assertRaises(click.ClickException):
                    action()
                self.assertEqual(note.path.read_bytes(), data)
        note.path.write_bytes(b"")
        self.assertEqual(self.store.read().lines, [])
        self.assertEqual(self.store.append("Fresh").lines[0].number, 1)
        note.path.unlink()
        for action in (self.store.read, lambda: self.store.append("new")):
            with self.assertRaises(click.ClickException):
                action()
        self.assertFalse(note.path.exists())

    def test_symlink_and_nonregular_files_are_rejected(self):
        note = self.store.append("Original")
        target = self.home / "private"
        note.path.rename(target)
        note.path.symlink_to(target)
        for action in (self.store.read, lambda: self.store.append("new")):
            with self.assertRaises(click.ClickException):
                action()
        self.assertEqual(target.read_text(), "Original\n")
        note.path.unlink()
        note.path.mkdir()
        with self.assertRaises(click.ClickException):
            self.store.read()

    def test_directory_and_lock_symlinks_are_rejected(self):
        target = self.home / "private"
        target.mkdir()
        directory = self.home / ".battuta/work"
        directory.parent.mkdir()
        directory.symlink_to(target, target_is_directory=True)
        with self.assertRaises(click.ClickException):
            self.store.append("new")
        directory.unlink()
        directory.mkdir()
        (directory / ".work-pm.lock").symlink_to(target / "lock")
        with self.assertRaises(click.ClickException):
            self.store.append("new")
        self.assertEqual(list(target.iterdir()), [])

    def test_failed_first_publication_removes_only_unpublished_file(self):
        directory = self.home / ".battuta/work"
        directory.mkdir(parents=True)
        orphan = directory / "note-pm-aaaaa.md"
        orphan.write_text("Preserve\n")
        with patch("battuta_project.work.secrets.choice", side_effect=list("aaaaabbbbb")), patch(
            "battuta_project.registry.atomic_write", side_effect=OSError("disk full")
        ):
            with self.assertRaises(click.ClickException):
                self.store.append("New")
        self.assertEqual(orphan.read_text(), "Preserve\n")
        self.assertFalse((directory / "note-pm-bbbbb.md").exists())
        self.assertIsNone(self.store.read())

    def test_parallel_appends_preserve_every_complete_note(self):
        texts = [f"Finding {index}" for index in range(20)]
        with ProcessPoolExecutor(max_workers=4) as pool:
            ids = list(pool.map(append_in_process, [(str(self.home), text) for text in texts]))
        self.assertEqual(len(set(ids)), 1)
        result = self.store.read()
        self.assertCountEqual([line.text for line in result.lines], texts)
        self.assertEqual(len(list(result.path.parent.glob("note-*.md"))), 1)
        self.assertEqual(result.path.read_bytes().count(b"\n"), 20)

    def test_parallel_todo_and_notebook_publication_preserves_both(self):
        with ProcessPoolExecutor(max_workers=2) as pool:
            note = pool.submit(append_in_process, (str(self.home), "Finding"))
            todo = pool.submit(todo_in_process, str(self.home))
            note_id, todo_id = note.result(), todo.result()
        self.assertNotEqual(note_id, todo_id)
        self.assertEqual(self.store.read().work_id, note_id)
        self.assertEqual(TodoStore("general", "pm").read().work_id, todo_id)
