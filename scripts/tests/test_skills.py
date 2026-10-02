"""Shared skill installation and migration for both management bots."""

from pathlib import Path
import sys
import tempfile
import unittest

import click

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bot_setup.skills import link_project_context  # noqa: E402


class SharedSkillTests(unittest.TestCase):
    def test_install_and_migrate_links_for_both_bots(self):
        for role in ("pm-bot", "tl-bot"):
            for existing in (None, "../../../shared-skills/project-context"):
                with self.subTest(role=role, existing=existing), tempfile.TemporaryDirectory() as directory:
                    root = Path(directory).resolve()
                    source = root / "shared-skills" / "project-context"
                    source.mkdir(parents=True)
                    (source / "SKILL.md").write_text("Shared project context")
                    bot = root / "bots" / role
                    skills = bot / ".pi" / "skills"
                    skills.mkdir(parents=True)
                    link = skills / "project-context"
                    if existing:
                        link.symlink_to(existing, target_is_directory=True)
                    link_project_context(bot)
                    self.assertEqual((link / "SKILL.md").read_text(), "Shared project context")
                    self.assertEqual(link.resolve(), source)
                    self.assertFalse(link.readlink().is_absolute())
                    link_project_context(bot)
                    self.assertEqual(link.resolve(), source)

    def test_preserves_custom_skill_entries(self):
        for entry in ("directory", "file", "symlink"):
            with self.subTest(entry=entry), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / "shared-skills" / "project-context").mkdir(parents=True)
                bot = root / "bots" / "pm-bot"
                link = bot / ".pi" / "skills" / "project-context"
                link.parent.mkdir(parents=True)
                if entry == "directory":
                    link.mkdir()
                elif entry == "file":
                    link.write_text("Custom skill")
                else:
                    link.symlink_to("custom-project-context")
                with self.assertRaises(click.ClickException):
                    link_project_context(bot)
                if entry == "directory":
                    self.assertTrue(link.is_dir())
                elif entry == "file":
                    self.assertEqual(link.read_text(), "Custom skill")
                else:
                    self.assertEqual(link.readlink(), Path("custom-project-context"))

    def test_missing_shared_skill_does_not_create_link(self):
        with tempfile.TemporaryDirectory() as directory:
            bot = Path(directory) / "bots" / "tl-bot"
            with self.assertRaises(click.ClickException):
                link_project_context(bot)
            self.assertFalse((bot / ".pi" / "skills").exists())
