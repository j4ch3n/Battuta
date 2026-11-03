"""Runtime catalog metadata and complete bot discovery resources."""

from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[3]


class SkillCatalogTests(unittest.TestCase):
    def test_catalog_has_unique_valid_entry_points(self):
        hub = ROOT / "skills-hub"
        self.assertTrue(hub.is_dir())
        names = []
        for skill in hub.iterdir():
            if not skill.is_dir():
                continue
            with self.subTest(skill=skill.name):
                self.assertRegex(skill.name, r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
                entry = skill / "SKILL.md"
                self.assertTrue(entry.is_file())
                metadata = entry.read_text().split("---", 2)[1]
                name = re.search(r"^name:\s*(\S+)\s*$", metadata, re.MULTILINE)
                self.assertIsNotNone(name)
                self.assertEqual(name.group(1), skill.name)
                names.append(name.group(1))
        self.assertEqual(len(names), len(set(names)))

    def test_bot_links_discover_complete_catalog_directories(self):
        for role in ("pm", "tl"):
            skills = ROOT / f"bots/{role}-bot/.pi/skills"
            for entry in skills.iterdir():
                if not (entry / "SKILL.md").is_file() and not entry.is_symlink():
                    continue
                with self.subTest(role=role, skill=entry.name):
                    self.assertTrue(entry.is_symlink())
                    self.assertEqual(entry.resolve(), ROOT / "skills-hub" / entry.name)
                    self.assertTrue((entry / "SKILL.md").is_file())
                    self.assertFalse(entry.readlink().is_absolute())
