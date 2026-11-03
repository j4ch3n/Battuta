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

    def test_changed_and_empty_selections_remove_only_owned_links(self):
        for role in ("pm", "tl"):
            with self.subTest(role=role), tempfile.TemporaryDirectory() as directory:
                root = Path(directory).resolve()
                skill_catalog(root, role)
                bot = root / "custom workspace"
                bot.mkdir()
                manifest = bot / "skills.json"
                manifest.write_text('{"skills":["memory","note-taking"]}')
                link_shared_skills(bot, role=role, root=root)
                skills = bot / ".pi/skills"
                (skills / "custom").mkdir()
                (skills / "custom/SKILL.md").write_text("keep directory")
                (skills / "extra").write_text("keep file")
                (skills / "unrelated").symlink_to("missing-custom-skill")
                (skills / "alias").symlink_to("../../../skills-hub/memory")
                (skills / "absolute").symlink_to(root / "skills-hub/memory")
                # A deleted catalog source must not prevent deselection cleanup.
                (root / "skills-hub/memory/SKILL.md").unlink()
                manifest.write_text('{"skills":["note-taking","todo"]}')
                for _ in range(2):
                    link_shared_skills(bot, role=role, root=root)
                    self.assertFalse((skills / "memory").is_symlink())
                    for name in ("note-taking", "todo"):
                        self.assertEqual((skills / name).readlink(), Path(f"../../../skills-hub/{name}"))
                        self.assertEqual((skills / name).resolve(), root / "skills-hub" / name)
                manifest.write_text('{"skills":[]}')
                for _ in range(2):
                    link_shared_skills(bot, role=role, root=root)
                    self.assertEqual({p.name for p in skills.iterdir()}, {"custom", "extra", "unrelated", "alias", "absolute"})
                    self.assertEqual((skills / "custom/SKILL.md").read_text(), "keep directory")
                    self.assertEqual((skills / "extra").read_text(), "keep file")
                    self.assertEqual((skills / "unrelated").readlink(), Path("missing-custom-skill"))
                    self.assertEqual((skills / "alias").readlink(), Path("../../../skills-hub/memory"))
                    self.assertEqual((skills / "absolute").readlink(), root / "skills-hub/memory")

    def test_deselected_link_is_removed_when_its_catalog_source_no_longer_exists(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            skill_catalog(root, "tl", [])
            (root / "skills-hub").mkdir()
            bot = root / "bots/tl-bot"
            link = bot / ".pi/skills/removed-skill"
            link.parent.mkdir(parents=True)
            link.symlink_to("../../../../skills-hub/removed-skill")
            link_shared_skills(bot, role="tl", root=root)
            self.assertFalse(link.is_symlink())
            self.assertEqual(list(link.parent.iterdir()), [])

    def test_failed_preflight_keeps_deselected_links_and_does_not_add_selected_links(self):
        for failure in ("missing", "file", "link"):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                skill_catalog(root, "pm", ["memory", "todo", "note-taking"])
                bot = root / "bots/pm-bot"
                skills = bot / ".pi/skills"
                skills.mkdir(parents=True)
                stale = skills / "memory"
                stale.symlink_to("../../../../skills-hub/memory")
                (bot / "skills.json").write_text('{"skills":["todo","note-taking"]}')
                if failure == "missing":
                    (root / "skills-hub/note-taking/SKILL.md").unlink()
                elif failure == "file":
                    (skills / "note-taking").write_text("custom")
                else:
                    (skills / "note-taking").symlink_to("custom-notes")
                with self.assertRaises(click.ClickException):
                    link_shared_skills(bot, role="pm", root=root)
                self.assertEqual(stale.readlink(), Path("../../../../skills-hub/memory"))
                self.assertFalse((skills / "todo").is_symlink())
                if failure == "file":
                    self.assertEqual((skills / "note-taking").read_text(), "custom")
                elif failure == "link":
                    self.assertEqual((skills / "note-taking").readlink(), Path("custom-notes"))

    def test_skills_directory_link_is_refused_without_modifying_its_target(self):
        for target in ("../../../skills-hub", "missing"):
            with self.subTest(target=target), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                skill_catalog(root, "pm", ["memory"])
                bot = root / "bots/pm-bot"
                (bot / ".pi").mkdir()
                skills = bot / ".pi/skills"
                skills.symlink_to(target)
                with self.assertRaises(click.ClickException):
                    link_shared_skills(bot, role="pm", root=root)
                self.assertEqual(skills.readlink(), Path(target))
                self.assertEqual({p.name for p in (root / "skills-hub").iterdir()}, {"memory"})
                self.assertTrue((root / "skills-hub/memory/SKILL.md").is_file())
