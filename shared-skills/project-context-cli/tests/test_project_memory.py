"""Memory semantics: normalized entries, line edits, and isolated files."""

from unittest.mock import patch

import click

from battuta_project.memory import ProjectMemory
from project_fixtures import ProjectTestCase


class MemoryTests(ProjectTestCase):
    def setUp(self):
        super().setUp()
        self.memory = ProjectMemory(self.project)
        self.path = self.project.root / "MEMORY.md"

    def test_missing_memory_is_empty_without_creating_file(self):
        self.assertEqual(self.memory.get(), [])
        self.assertFalse(self.path.exists())

    def test_append_stores_one_trimmed_line_and_reports_index(self):
        self.assertEqual(self.memory.append("  Use PostgreSQL.  "), 1)
        self.assertEqual(self.memory.append("Run migrations."), 2)
        self.assertEqual(self.path.read_text(), "Use PostgreSQL.\nRun migrations.\n")
        self.assertEqual([(e.index, e.content) for e in self.memory.get()], [(1, "Use PostgreSQL."), (2, "Run migrations.")])

    def test_replace_changes_only_the_requested_one_based_line(self):
        self.memory.replace_all("First\nSecond\nThird")
        self.memory.replace(2, "  Revised second  ")
        self.assertEqual(self.path.read_text(), "First\nRevised second\nThird\n")

    def test_replace_all_trims_drops_blanks_and_clears(self):
        self.assertEqual(self.memory.replace_all("  First  \r\n\r\n Second \n \t \nThird"), 3)
        self.assertEqual(self.path.read_text(), "First\nSecond\nThird\n")
        self.assertEqual(self.memory.replace_all(" \n\t"), 0)
        self.assertEqual(self.path.read_text(), "")

    def test_invalid_single_lines_and_indexes_preserve_memory(self):
        self.memory.replace_all("First\nSecond")
        for content in ("", " \t", "First\nSecond", "First\rSecond", "First\n"):
            with self.subTest(content=repr(content)):
                for action in (self.memory.append, lambda value: self.memory.replace(1, value)):
                    with self.assertRaises(click.ClickException):
                        action(content)
                self.assertEqual(self.path.read_text(), "First\nSecond\n")
        for index in (0, -1, 3):
            with self.subTest(index=index), self.assertRaises(click.ClickException):
                self.memory.replace(index, "Changed")
            self.assertEqual(self.path.read_text(), "First\nSecond\n")

    def test_legacy_blank_lines_are_indexed_until_explicit_reconciliation(self):
        self.path.write_text("First\n\n  Third  \n")
        self.assertEqual([(e.index, e.content) for e in self.memory.get()], [(1, "First"), (2, ""), (3, "  Third  ")])
        self.memory.replace(2, "Second")
        self.assertEqual(self.path.read_text(), "First\nSecond\n  Third  \n")

    def test_memory_is_isolated_between_projects(self):
        self.memory.append("Atlas decision")
        harbor = self.registry.init("https://github.com/team/harbor-web")
        ProjectMemory(harbor).append("Harbor decision")
        self.assertEqual(self.path.read_text(), "Atlas decision\n")
        self.assertEqual((harbor.root / "MEMORY.md").read_text(), "Harbor decision\n")

    def test_symlink_memory_never_reads_or_overwrites_target(self):
        outside = self.home / "outside.md"
        outside.write_text("Keep me")
        self.path.symlink_to(outside)
        for action in (self.memory.get, lambda: self.memory.append("new"), lambda: self.memory.replace_all("new")):
            with self.assertRaises(click.ClickException):
                action()
        self.assertEqual(outside.read_text(), "Keep me")

    def test_failed_atomic_replace_preserves_memory_and_removes_temporary(self):
        self.memory.append("Keep me")
        with patch("battuta_project.storage.os.replace", side_effect=OSError("disk full")):
            with self.assertRaisesRegex(click.ClickException, "disk full"):
                self.memory.replace_all("Changed")
        self.assertEqual(self.path.read_text(), "Keep me\n")
        self.assertEqual(sorted(p.name for p in self.project.root.iterdir()), ["MEMORY.md", "code", "project.yaml"])
