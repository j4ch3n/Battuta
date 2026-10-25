"""Ordered next-item and remaining-queue persistence contracts."""

from concurrent.futures import ProcessPoolExecutor
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from battuta_project.todo_errors import TodoError, TodoErrorCode
from battuta_project.todos import TodoStore
from battuta_project.registry import ProjectRegistry


def advance_in_process(home):
    with patch("pathlib.Path.home", return_value=Path(home)):
        TodoStore("general", "pm").advance("done", rational="Verified the step's outcome")


def create_in_process(args):
    home, role = args
    with patch("pathlib.Path.home", return_value=Path(home)):
        return TodoStore("general", role).create([role]).work_id


def switch_in_process(args):
    home, project = args
    with patch("pathlib.Path.home", return_value=Path(home)):
        ProjectRegistry().switch(project)


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
        return self.store.create(list(items), force=force)

    def test_roles_create_independently_and_extend_their_own_work(self):
        for role in ("pm", "tl"):
            with self.subTest(role=role):
                store = TodoStore("general", role)
                with self.assertRaisesRegex(TodoError, "NO_CURRENT_WORK"):
                    store.extend(["Not started"])
                created = store.create(["First"])
                self.assertRegex(created.work_id, r"^[a-z0-9]{5}$")
                self.assertEqual(created.path.name, f"todo-{role}-{created.work_id}.jsonl")
                state = store.registry.state_path.read_bytes()
                before = created.path.read_bytes()
                result = store.extend(["Second", "Third"])
                self.assertEqual(result.path, created.path)
                self.assertTrue(result.path.read_bytes().startswith(before))
                self.assertEqual([item.id for item in result.items], [1, 2, 3])
                self.assertEqual(store.registry.state_path.read_bytes(), state)
                for invalid in ([], [" "], [42]):
                    with self.assertRaisesRegex(TodoError, "INVALID_INPUT"):
                        store.extend(invalid)
                for _ in range(3):
                    store.advance("done", "Checked")
                self.assertEqual(store.extend(["More"]).items[-1].id, 4)
                store.advance("done", "Checked")
                self.assertNotEqual(store.create(["New work"]).work_id, created.work_id)

    def test_related_work_retains_historical_target_and_does_not_switch_roles(self):
        pm = self.store.create(["PM"])
        tl_store = TodoStore("general", "tl")
        tl = tl_store.create(["TL"], related_to=f"pm:{pm.work_id}")
        self.assertNotEqual(pm.work_id, tl.work_id)
        self.assertEqual(self.store.read().path, pm.path)
        self.store.create(["Later PM"], force=True)
        self.assertEqual(tl_store.extend(["More TL"]).related_to, f"pm:{pm.work_id}")
        tl_store.create(["Later TL"], force=True, related_to=f"pm:{pm.work_id}")
        self.assertEqual(tl_store.registry.work_record(None, "tl", tl.work_id).related_to, f"pm:{pm.work_id}")

    def test_invalid_related_references_do_not_publish_work(self):
        for reference in ("pm:../xx", "pm:abc12", "engineer:abc12", "abc12", "pm:ABCDE"):
            with self.subTest(reference=reference), self.assertRaisesRegex(TodoError, "INVALID_REFERENCE"):
                self.store.create(["New"], related_to=reference)
        self.assertIsNone(self.store.read())
        registry = ProjectRegistry()
        registry.init("atlas")
        project_work = TodoStore("project", "tl").create(["Project TL"])
        with self.assertRaisesRegex(TodoError, "INVALID_REFERENCE"):
            self.store.create(["General"], related_to=f"tl:{project_work.work_id}")

    def test_collision_checks_both_roles_orphans_and_metadata(self):
        self.store.directory.mkdir(parents=True)
        orphan = self.store.directory / "todo-tl-aaaaa.jsonl"
        orphan.write_text("Preserve orphan")
        with patch("battuta_project.todos.secrets.choice", side_effect=list("aaaaabbbbb")):
            created = self.create("New")
        self.assertEqual(created.work_id, "bbbbb")
        self.assertEqual(orphan.read_text(), "Preserve orphan")
        with patch("battuta_project.todos.secrets.choice", return_value="a"):
            with self.assertRaisesRegex(TodoError, "WORK_ID_COLLISION"):
                self.create("Collision", force=True)
        self.assertEqual(self.store.read().work_id, "bbbbb")
        # Retained metadata still reserves an ID when its historical file is absent.
        self.store.create(["Later"], force=True)
        created.path.unlink()
        with patch("battuta_project.todos.secrets.choice", side_effect=list("bbbbbccccc")):
            self.assertEqual(self.store.create(["Newest"], force=True).work_id, "ccccc")
        outside = self.home / "private"
        outside.write_text("Keep")
        (self.store.directory / "todo-tl-ddddd.jsonl").symlink_to(outside)
        with patch("battuta_project.todos.secrets.choice", side_effect=list("dddddeeeee")):
            self.assertEqual(self.store.create(["Safe"], force=True).work_id, "eeeee")
        self.assertEqual(outside.read_text(), "Keep")

    def test_legacy_continuation_and_independent_role_migration(self):
        self.store.directory.mkdir(parents=True)
        paths = {}
        for role in ("pm", "tl"):
            path = self.store.directory / f"todo-{role}-20261023T120000Z.jsonl"
            path.write_text('{"id":1,"status":"todo","description":"Legacy","rational":""}\n')
            paths[role] = path
        self.assertIsNone(self.store.read().work_id)
        with self.assertRaisesRegex(TodoError, "UNFINISHED_TODO"):
            self.create("New")
        with self.assertRaisesRegex(TodoError, "NO_CURRENT_WORK"):
            self.store.extend(["No legacy extension"])
        self.store.advance("done", "Checked legacy")
        legacy_bytes = paths["pm"].read_bytes()
        current = self.create("New")
        self.assertEqual(paths["pm"].read_bytes(), legacy_bytes)
        tl = TodoStore("general", "tl")
        self.assertIsNone(tl.read().work_id)
        tl.update_todo(["Revised legacy"])
        tl.advance("cancelled", "No longer needed")
        current.path.unlink()
        for action in (self.store.read, lambda: self.store.extend(["Missing"]), lambda: self.create("Force", force=True)):
            with self.assertRaisesRegex(TodoError, "INVALID_TODO_FILE"):
                action()

    def test_invalid_legacy_timestamp_is_rejected(self):
        self.store.directory.mkdir(parents=True)
        (self.store.directory / "todo-pm-20261323T120000Z.jsonl").write_text("unused")
        with self.assertRaisesRegex(TodoError, "INVALID_TODO_FILE"):
            self.store.read()

    def test_failed_publication_preserves_pointer_history_and_removes_new_file(self):
        first = self.create("Original")
        before = first.path.read_bytes()
        config = self.store.registry.state_path.read_bytes()
        with patch("battuta_project.registry.atomic_write", side_effect=OSError("disk full")):
            with self.assertRaisesRegex(TodoError, "TODO_STORAGE_ERROR"):
                self.create("New", force=True)
        self.assertEqual(self.store.registry.state_path.read_bytes(), config)
        self.assertEqual(first.path.read_bytes(), before)
        self.assertEqual(list(self.store.directory.glob("*.jsonl")), [first.path])

    def test_parallel_role_publication_preserves_both_pointers(self):
        with ProcessPoolExecutor(max_workers=2) as pool:
            ids = list(pool.map(create_in_process, [(str(self.home), role) for role in ("pm", "tl")]))
        for role, work_id in zip(("pm", "tl"), ids):
            self.assertEqual(TodoStore("general", role).read().work_id, work_id)

    def test_publication_and_project_switch_preserve_state(self):
        registry = ProjectRegistry()
        registry.init("atlas")
        registry.init("harbor")
        with ProcessPoolExecutor(max_workers=2) as pool:
            publication = pool.submit(create_in_process, (str(self.home), "tl"))
            switch = pool.submit(switch_in_process, (str(self.home), "atlas"))
            work_id = publication.result()
            switch.result()
        self.assertEqual(registry.current_name(), "atlas")
        self.assertEqual(registry.current_work_id(None, "tl"), work_id)

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
        # The persisted pointer, not mtime, determines the active list.
        first.path.touch()
        self.assertEqual(self.store.read().path, second.path)

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
