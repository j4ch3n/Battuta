"""Shared skill installation and migration for both management bots."""

from pathlib import Path
from itertools import product
import sys
import tempfile
import unittest

import click

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bot_setup.skills import link_project_context, link_shared_skills  # noqa: E402


class SharedSkillTests(unittest.TestCase):
    def test_working_skills_are_discoverable_and_idempotent_for_both_roles(self):
        for role in ("pm", "tl"):
            with self.subTest(role=role), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bot = root / f"bots/{role}-bot"
                for name in ("project-context", "todo", "note-taking", "draft-writing"):
                    source = root / "shared-skills" / name
                    (source / "references").mkdir(parents=True)
                    (source / "SKILL.md").write_text(name)
                    (source / "references/commands.md").write_text(f"{name} commands")
                for _ in range(2):
                    link_shared_skills(bot, role=role, root=root)
                    for name in ("project-context", "todo", "note-taking", "draft-writing"):
                        link = bot / ".pi/skills" / name
                        self.assertEqual(link.resolve(), (root / "shared-skills" / name).resolve())
                        self.assertEqual((link / "SKILL.md").read_text(), name)
                        self.assertEqual((link / "references/commands.md").read_text(), f"{name} commands")

    def test_working_skill_conflicts_preserve_custom_entries(self):
        for role, name, kind in product(("pm", "tl"), ("todo", "note-taking", "draft-writing"), ("directory", "file", "symlink")):
            with self.subTest(role=role, name=name, kind=kind), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                for skill in ("project-context", "todo", "note-taking", "draft-writing"):
                    (root / "shared-skills" / skill).mkdir(parents=True)
                bot = root / f"bots/{role}-bot"
                target = bot / ".pi/skills" / name
                target.parent.mkdir(parents=True)
                if kind == "directory":
                    target.mkdir()
                    (target / "SKILL.md").write_text("Custom")
                elif kind == "file":
                    target.write_text("Custom")
                else:
                    target.symlink_to("custom-skill")
                with self.assertRaises(click.ClickException):
                    link_shared_skills(bot, role=role, root=root)
                if kind == "directory":
                    self.assertEqual((target / "SKILL.md").read_text(), "Custom")
                elif kind == "file":
                    self.assertEqual(target.read_text(), "Custom")
                else:
                    self.assertEqual(target.readlink(), Path("custom-skill"))

    def test_missing_working_skill_is_not_linked(self):
        for role, missing in product(("pm", "tl"), ("todo", "note-taking", "draft-writing")):
            with self.subTest(role=role, missing=missing), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                for name in {"project-context", "todo", "note-taking", "draft-writing"} - {missing}:
                    (root / "shared-skills" / name).mkdir(parents=True)
                bot = root / f"bots/{role}-bot"
                with self.assertRaises(click.ClickException):
                    link_shared_skills(bot, role=role, root=root)
                self.assertFalse((bot / ".pi/skills" / missing).is_symlink())

    def test_local_memory_installation_migrates_owned_links_and_preserves_custom_entries(self):
        for role, existing in product(("pm", "tl"), (None, "owned", "directory", "symlink", "file")):
            with self.subTest(role=role, existing=existing), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                for name in ("project-context", "todo", "note-taking", "draft-writing"):
                    (root / "shared-skills" / name).mkdir(parents=True)
                source = root / f"bots/{role}-bot/.pi/skills/memory"
                (source / "references").mkdir(parents=True)
                (source / "SKILL.md").write_text(f"{role} memory")
                (source / "references/tools.md").write_text(f"{role} tools")
                bot = root / "bots/custom-assistant"
                link = bot / ".pi/skills/memory"
                link.parent.mkdir(parents=True)
                if existing == "directory":
                    link.mkdir()
                    (link / "SKILL.md").write_text("Custom memory")
                elif existing == "symlink":
                    link.symlink_to("custom-memory")
                elif existing == "owned":
                    link.symlink_to("../../../../shared-skills/memory")
                elif existing == "file":
                    link.write_text("Custom memory")
                if existing in ("symlink", "file"):
                    with self.assertRaises(click.ClickException):
                        link_shared_skills(bot, role=role, root=root)
                    if existing == "symlink":
                        self.assertEqual(link.readlink(), Path("custom-memory"))
                    elif existing == "file":
                        self.assertEqual(link.read_text(), "Custom memory")
                else:
                    for _ in range(2):
                        link_shared_skills(bot, role=role, root=root)
                        self.assertFalse(link.is_symlink())
                        self.assertEqual((link / "SKILL.md").read_text(), "Custom memory" if existing == "directory" else f"{role} memory")
                        if existing != "directory":
                            self.assertEqual((link / "references/tools.md").read_text(), f"{role} tools")

    def test_bundled_memory_stays_local_and_tl_role_link_can_migrate(self):
        for role in ("pm", "tl"):
            with self.subTest(role=role), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                for name in ("project-context", "todo", "note-taking", "draft-writing"):
                    (root / "shared-skills" / name).mkdir(parents=True)
                source = root / f"bots/{role}-bot/.pi/skills/memory"
                source.mkdir(parents=True)
                (source / "SKILL.md").write_text(f"{role} memory")
                link_shared_skills(source.parents[2], role=role, root=root)
                self.assertFalse(source.is_symlink())
                if role == "tl":
                    bot = root / "bots/custom-tl"
                    link = bot / ".pi/skills/memory"
                    link.parent.mkdir(parents=True)
                    link.symlink_to("../../../../shared-skills/memory-tl")
                    link_shared_skills(bot, role=role, root=root)
                    self.assertFalse(link.is_symlink())
                    self.assertEqual((link / "SKILL.md").read_text(), "tl memory")

    def test_install_and_migrate_links_for_both_bots(self):
        for role in ("pm-bot", "tl-bot"):
            for existing in (None, "../../../shared-skills/project-context"):
                with self.subTest(role=role, existing=existing), tempfile.TemporaryDirectory() as directory:
                    root = Path(directory).resolve()
                    source = root / "shared-skills" / "project-context"
                    source.mkdir(parents=True)
                    (source / "SKILL.md").write_text("Shared project context")
                    references = source / "references"
                    specify = references / "specify"
                    specify.mkdir(parents=True)
                    (specify / "prompt.md").write_text("Runtime specification prompt")
                    (specify / "template.md").write_text("Runtime specification template")
                    bot = root / "bots" / role
                    skills = bot / ".pi" / "skills"
                    skills.mkdir(parents=True)
                    link = skills / "project-context"
                    if existing:
                        link.symlink_to(existing, target_is_directory=True)
                    link_project_context(bot)
                    self.assertEqual((link / "SKILL.md").read_text(), "Shared project context")
                    self.assertEqual((link / "references" / "specify" / "prompt.md").read_text(), "Runtime specification prompt")
                    self.assertEqual((link / "references" / "specify" / "template.md").read_text(), "Runtime specification template")
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
