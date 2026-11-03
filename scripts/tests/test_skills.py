"""Manifest-selected runtime skill links preserve unrelated custom content."""

from itertools import product
import json
from pathlib import Path
import sys
import tempfile
import unittest

import click

from skill_fixtures import skill_catalog

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bot_setup.skills import link_shared_skills  # noqa: E402


class SkillSetupTests(unittest.TestCase):
    def test_role_manifests_link_complete_skills_idempotently_in_custom_workspaces(self):
        for role in ("pm", "tl"):
            with self.subTest(role=role), tempfile.TemporaryDirectory() as directory:
                root = Path(directory).resolve()
                names = skill_catalog(root, role)
                bot = root / "custom workspace"
                for _ in range(2):
                    link_shared_skills(bot, role=role, root=root)
                    self.assertEqual({p.name for p in (bot / ".pi/skills").iterdir()}, set(names))
                    for name in names:
                        link = bot / ".pi/skills" / name
                        self.assertTrue(link.is_symlink())
                        self.assertFalse(link.readlink().is_absolute())
                        self.assertEqual(link.resolve(), root / "skills-hub" / name)
                        self.assertEqual((link / "references/tools.md").read_text(), f"{name} tools")

    def test_workspace_manifest_overrides_role_selection(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            skill_catalog(root, "pm")
            bot = root / "custom"
            bot.mkdir()
            manifest = bot / "skills.json"
            manifest.write_text('{"skills":["note-taking"]}')
            link_shared_skills(bot, role="pm", root=root)
            self.assertEqual([p.name for p in (bot / ".pi/skills").iterdir()], ["note-taking"])
            self.assertEqual(json.loads(manifest.read_text()), {"skills": ["note-taking"]})

    def test_invalid_selection_does_not_change_existing_output(self):
        for invalid in ("missing", "../memory", "memory"):
            with self.subTest(invalid=invalid), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                skill_catalog(root, "pm")
                bot = root / "bots/pm-bot"
                (bot / "skills.json").write_text(json.dumps({"skills": ["note-taking", invalid]}))
                if invalid == "memory":
                    (root / "skills-hub/memory/SKILL.md").unlink()
                link = bot / ".pi/skills/note-taking"
                link.parent.mkdir(parents=True)
                link.symlink_to("../../../../shared-skills/note-taking")
                with self.assertRaises(click.ClickException):
                    link_shared_skills(bot, role="pm", root=root)
                self.assertEqual(link.readlink(), Path("../../../../shared-skills/note-taking"))
                self.assertEqual(list(link.parent.iterdir()), [link])

    def test_custom_directories_are_preserved_and_other_conflicts_fail(self):
        for role, kind in product(("pm", "tl"), ("directory", "file", "link")):
            with self.subTest(role=role, kind=kind), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                skill_catalog(root, role)
                bot = root / f"bots/{role}-bot"
                target = bot / ".pi/skills/memory"
                target.parent.mkdir(parents=True)
                if kind == "directory":
                    target.mkdir()
                    (target / "SKILL.md").write_text("custom")
                    link_shared_skills(bot, role=role, root=root)
                    self.assertEqual((target / "SKILL.md").read_text(), "custom")
                else:
                    if kind == "file":
                        target.write_text("custom")
                    else:
                        target.symlink_to("custom-memory")
                    with self.assertRaises(click.ClickException):
                        link_shared_skills(bot, role=role, root=root)
                    self.assertEqual(target.read_text() if kind == "file" else str(target.readlink()), "custom" if kind == "file" else "custom-memory")

    def test_recognized_legacy_links_migrate_without_overwriting_unselected_content(self):
        for legacy in ("../../../../shared-skills/memory", "../../../../shared-skills/memory-tl"):
            with self.subTest(legacy=legacy), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                skill_catalog(root, "tl")
                bot = root / "bots/tl-bot"
                link = bot / ".pi/skills/memory"
                link.parent.mkdir(parents=True)
                link.symlink_to(legacy)
                custom = link.parent / "extra"
                custom.write_text("keep")
                link_shared_skills(bot, role="tl", root=root)
                self.assertEqual(link.resolve(), (root / "skills-hub/memory").resolve())
                self.assertEqual(custom.read_text(), "keep")

    def test_unknown_role_fails_without_creating_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaises(click.ClickException):
                link_shared_skills(root / "bot", role="unknown", root=root)
            self.assertFalse((root / "bot").exists())
